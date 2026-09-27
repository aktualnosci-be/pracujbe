import { z } from 'zod/v3';

/**
 * Dane polowe Core Web Vitals (LCP, INP, CLS) z Cloudflare Web Analytics — czysty moduł (bez I/O).
 *
 * Portal NIE ma własnej zbiórki metryk: beacon Cloudflare Web Analytics (#570/#635) mierzy
 * LCP/INP/CLS sam i ładuje się wyłącznie po zgodzie w kategorii `analytics` i tylko na trasach
 * publicznych (`Analytics.tsx`, `route-policy.ts`, Invariant #7). Ten moduł buduje zapytanie
 * do GraphQL Analytics API (zbiór `rumWebVitalsEventsAdaptiveGroups`, agregaty p75 per ścieżka)
 * i waliduje odpowiedź dla podglądu w `/admin/wydajnosc`. Żadnych identyfikatorów osób:
 * API zwraca tylko ścieżkę, liczbę (próbkowaną) i kwantyle.
 */

export const WEB_VITALS_PERIODS = [7, 28] as const;
export type WebVitalsPeriod = (typeof WEB_VITALS_PERIODS)[number];

/** Liczba ścieżek w tabeli (najczęściej odwiedzane). */
export const WEB_VITALS_PATH_LIMIT = 20;

/** Poniżej tej liczby pomiarów p75 jest mało wiarygodne — strona to zaznacza. */
export const WEB_VITALS_MIN_SAMPLE = 50;

export type WebVitalMetric = 'lcp' | 'inp' | 'cls';
export type WebVitalRating = 'good' | 'needsImprovement' | 'poor';

/** Progi web.dev (p75): dobre ≤ pierwszy, słabe > drugi. LCP/INP w ms, CLS bez jednostki. */
export const WEB_VITAL_THRESHOLDS: Record<WebVitalMetric, readonly [number, number]> = {
  lcp: [2500, 4000],
  inp: [200, 500],
  cls: [0.1, 0.25],
};

export function rateWebVital(metric: WebVitalMetric, value: number | null): WebVitalRating | null {
  if (value === null) return null;
  const [good, poor] = WEB_VITAL_THRESHOLDS[metric];
  if (value <= good) return 'good';
  if (value <= poor) return 'needsImprovement';
  return 'poor';
}

export interface WebVitalsConfig {
  accountId: string;
  siteTag: string;
  apiToken: string;
}

const HEX32 = /^[0-9a-f]{32}$/i;

/**
 * Konfiguracja z env. Identyfikator konta i site tag Cloudflare to 32 znaki hex; token API
 * (uprawnienie „Account Analytics: Read”) tylko na serwerze — nigdy `NEXT_PUBLIC_*`.
 * Brak albo zły zapis któregokolwiek = `null` (strona pokazuje instrukcję, nic nie wysyła).
 */
export function readWebVitalsConfig(env: Record<string, string | undefined>): WebVitalsConfig | null {
  const accountId = env.CF_ANALYTICS_ACCOUNT_ID?.trim() ?? '';
  const siteTag = env.CF_WEB_ANALYTICS_SITE_TAG?.trim() ?? '';
  const apiToken = env.CF_ANALYTICS_API_TOKEN?.trim() ?? '';
  if (!HEX32.test(accountId) || !HEX32.test(siteTag) || apiToken.length < 20) return null;
  return { accountId, siteTag, apiToken };
}

export function isWebVitalsPeriod(value: unknown): value is WebVitalsPeriod {
  return WEB_VITALS_PERIODS.includes(Number(value) as WebVitalsPeriod);
}

/** `?dni=` z adresu → okres (domyślnie 28 dni, jak okno CrUX). */
export function parseWebVitalsPeriod(raw: string | string[] | undefined): WebVitalsPeriod {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return isWebVitalsPeriod(value) ? (Number(value) as WebVitalsPeriod) : 28;
}

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Zakres dat (UTC, włącznie z dzisiejszym dniem) — Cloudflare filtruje po dacie przeglądarki. */
export function webVitalsDateRange(period: WebVitalsPeriod, now: Date): { from: string; to: string } {
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const from = new Date(to.getTime() - (period - 1) * 86_400_000);
  return { from: ymd(from), to: ymd(to) };
}

const QUANTILES = 'quantiles { largestContentfulPaintP75 interactionToNextPaintP75 cumulativeLayoutShiftP75 }';

/** Stałe zapytanie; wartości wyłącznie w zmiennych GraphQL (bez sklejania tekstu z env). */
export const WEB_VITALS_QUERY = `query PracujbeFieldWebVitals($accountTag: string!, $filter: AccountRumWebVitalsEventsAdaptiveGroupsFilter_InputObject!, $limit: uint64!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      total: rumWebVitalsEventsAdaptiveGroups(filter: $filter, limit: 1) { count ${QUANTILES} }
      paths: rumWebVitalsEventsAdaptiveGroups(filter: $filter, limit: $limit, orderBy: [count_DESC]) { count dimensions { requestPath } ${QUANTILES} }
    }
  }
}`;

export function buildWebVitalsRequest(config: WebVitalsConfig, period: WebVitalsPeriod, now: Date) {
  const { from, to } = webVitalsDateRange(period, now);
  return {
    query: WEB_VITALS_QUERY,
    variables: {
      accountTag: config.accountId,
      // `bot: 0` — tylko ruch ludzi (Cloudflare oznacza ruch automatów).
      filter: { siteTag: config.siteTag, date_geq: from, date_leq: to, bot: 0 },
      limit: WEB_VITALS_PATH_LIMIT,
    },
  };
}

const quantilesSchema = z.object({
  largestContentfulPaintP75: z.number(),
  interactionToNextPaintP75: z.number(),
  cumulativeLayoutShiftP75: z.number(),
});

const groupSchema = z.object({ count: z.number().nonnegative(), quantiles: quantilesSchema });

const responseSchema = z.object({
  data: z
    .object({
      viewer: z.object({
        accounts: z.array(
          z.object({
            total: z.array(groupSchema),
            paths: z.array(groupSchema.extend({ dimensions: z.object({ requestPath: z.string() }) })),
          }),
        ),
      }),
    })
    .nullable()
    .optional(),
  errors: z.array(z.unknown()).nullable().optional(),
});

export interface WebVitalsRow {
  /** Liczba pomiarów (Cloudflare próbkuje i mnoży — wartość szacunkowa). */
  count: number;
  /** p75 w milisekundach; `null` = brak pomiaru (Cloudflare zwraca wartość ujemną). */
  lcpMs: number | null;
  inpMs: number | null;
  /** p75 CLS; mierzone tylko w przeglądarkach Chromium. */
  cls: number | null;
}

export interface WebVitalsPathRow extends WebVitalsRow {
  path: string;
}

export interface WebVitalsReport {
  from: string;
  to: string;
  total: WebVitalsRow;
  paths: WebVitalsPathRow[];
}

/** Mikrosekundy z API → ms (zaokrąglone); ujemne = brak danych. */
function microsToMs(value: number): number | null {
  return value < 0 ? null : Math.round(value / 1000);
}

function toRow(group: z.infer<typeof groupSchema>): WebVitalsRow {
  const q = group.quantiles;
  return {
    count: Math.round(group.count),
    lcpMs: microsToMs(q.largestContentfulPaintP75),
    inpMs: microsToMs(q.interactionToNextPaintP75),
    cls: q.cumulativeLayoutShiftP75 < 0 ? null : Math.round(q.cumulativeLayoutShiftP75 * 1000) / 1000,
  };
}

/**
 * Ścieżka do wyświetlenia: bez query i fragmentu (API ich nie zwraca, ale nie ufamy), tylko
 * znaki drukowalne, najwyżej 200 znaków. Beacon działa wyłącznie na trasach publicznych.
 */
export function displayPath(raw: string): string {
  const path = raw.split(/[?#]/)[0] ?? '';
  const clean = path.replace(/[^\x21-\x7e]/g, '');
  const bounded = clean.length > 200 ? `${clean.slice(0, 199)}…` : clean;
  return bounded.startsWith('/') ? bounded : `/${bounded}`;
}

export type ParsedWebVitals =
  | { ok: true; report: WebVitalsReport }
  | { ok: false; code: 'CF_API_ERROR' | 'CF_BAD_RESPONSE' };

/** Walidacja odpowiedzi GraphQL; błędy API → sam kod (bez treści dostawcy, Invariant #8). */
export function parseWebVitalsResponse(
  body: unknown,
  range: { from: string; to: string },
): ParsedWebVitals {
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) return { ok: false, code: 'CF_BAD_RESPONSE' };
  if (parsed.data.errors && parsed.data.errors.length > 0) return { ok: false, code: 'CF_API_ERROR' };
  const account = parsed.data.data?.viewer.accounts[0];
  if (!account) return { ok: false, code: 'CF_BAD_RESPONSE' };
  const totalGroup = account.total[0];
  return {
    ok: true,
    report: {
      ...range,
      total: totalGroup ? toRow(totalGroup) : { count: 0, lcpMs: null, inpMs: null, cls: null },
      paths: account.paths.map((group) => ({ path: displayPath(group.dimensions.requestPath), ...toRow(group) })),
    },
  };
}

/**
 * Raport przykładowy trybu DEMO (bez bazy i bez konfiguracji Cloudflare) — jak inne strony
 * admina w demo; strona oznacza go jako dane przykładowe. Nigdy w trybie z bazą.
 */
export function demoWebVitalsReport(period: WebVitalsPeriod, now: Date): WebVitalsReport {
  return {
    ...webVitalsDateRange(period, now),
    total: { count: 1840, lcpMs: 2140, inpMs: 168, cls: 0.03 },
    paths: [
      { path: '/pl', count: 720, lcpMs: 1860, inpMs: 120, cls: 0.02 },
      { path: '/pl/oferty-pracy', count: 540, lcpMs: 2380, inpMs: 210, cls: 0.04 },
      { path: '/nl/vacatures', count: 310, lcpMs: 2920, inpMs: 240, cls: 0.12 },
      { path: '/fr/offres-emploi', count: 170, lcpMs: 4310, inpMs: 530, cls: 0.27 },
      { path: '/en/jobs', count: 40, lcpMs: 2050, inpMs: null, cls: null },
    ],
  };
}

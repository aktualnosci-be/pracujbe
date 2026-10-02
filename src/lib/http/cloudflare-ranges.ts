import 'server-only';

import { isValidCidr, parseIp } from '@/lib/http/ip-cidr';

/**
 * Zakresy adresów brzegu Cloudflare dla `trustedClientIp` w trybie `cf-connecting-ip` (#1090,
 * decyzja właściciela 30.09.2026: pobierane automatycznie, stała lista = zapas).
 *
 * - Źródło: https://www.cloudflare.com/ips-v4 i /ips-v6 (tekst, jeden CIDR w wierszu).
 * - Ścieżka żądania NIGDY nie czeka na sieć: `cloudflareIpRanges()` zwraca od razu ostatnią
 *   dobrą listę (albo zapas z kodu) i — gdy lista jest starsza niż TTL — uruchamia odświeżenie
 *   w tle (single-flight: jedno pobranie naraz na proces).
 * - Pobranie: timeout 3 s, bez przekierowań, limit rozmiaru; każda linia musi być poprawnym
 *   CIDR właściwej rodziny, a lista nie może być pusta ani podejrzanie krótka — inaczej wynik
 *   jest odrzucany i zostaje poprzednia lista. Po błędzie kolejna próba najwcześniej po
 *   `RETRY_AFTER_ERROR_MS` (bez zasypywania Cloudflare przy każdym żądaniu).
 * - Moduł działa w runtime Node (trasy API i Server Actions); middleware (Edge) nie liczy IP.
 */

/** Zapas: opublikowane zakresy (stan 2026-09), gdy pobranie się nie udało albo jeszcze trwa. */
export const CLOUDFLARE_IP_RANGES: readonly string[] = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18',
  '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17',
  '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32',
  '2a06:98c0::/29', '2c0f:f248::/32',
];

export const CLOUDFLARE_IPS_V4_URL = 'https://www.cloudflare.com/ips-v4';
export const CLOUDFLARE_IPS_V6_URL = 'https://www.cloudflare.com/ips-v6';

export const RANGES_TTL_MS = 24 * 60 * 60 * 1000;
export const RETRY_AFTER_ERROR_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 3000;
const MAX_BODY_CHARS = 16 * 1024;
const MAX_LINES = 200;
/** Poniżej tylu zakresów lista jest podejrzana (dziś 15 IPv4 i 7 IPv6). */
const MIN_V4 = 5;
const MIN_V6 = 3;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

type State = {
  ranges: readonly string[] | null;
  fetchedAt: number;
  failedAt: number;
  inFlight: Promise<boolean> | null;
};

const state: State = { ranges: null, fetchedAt: 0, failedAt: 0, inFlight: null };

/** Parsuje odpowiedź jednej listy; `null` = odrzucona (zły CIDR, zła rodzina, za krótka). */
export function parseCloudflareList(body: string, family: 4 | 6): string[] | null {
  if (body.length > MAX_BODY_CHARS) return null;
  const lines = body.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '');
  if (lines.length === 0 || lines.length > MAX_LINES) return null;
  for (const line of lines) {
    if (!isValidCidr(line) || parseIp(line.split('/')[0]!)?.v !== family) return null;
  }
  if (lines.length < (family === 4 ? MIN_V4 : MIN_V6)) return null;
  return lines;
}

async function fetchList(fetchImpl: FetchLike, url: string, family: 4 | 6): Promise<string[] | null> {
  const res = await fetchImpl(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: 'error',
    cache: 'no-store',
    headers: { accept: 'text/plain' },
  });
  if (!res.ok) return null;
  return parseCloudflareList(await res.text(), family);
}

/**
 * Pobiera obie listy i przy sukcesie zastępuje bieżącą. Wynik: czy lista została zastąpiona.
 * Nigdy nie rzuca (błąd = zostaje poprzednia lista). Single-flight: równoległe wywołania dzielą
 * jedno pobranie.
 */
export function refreshCloudflareRanges(fetchImpl: FetchLike = (i, init) => fetch(i, init)): Promise<boolean> {
  if (state.inFlight) return state.inFlight;
  const run = (async () => {
    try {
      const [v4, v6] = await Promise.all([
        fetchList(fetchImpl, CLOUDFLARE_IPS_V4_URL, 4),
        fetchList(fetchImpl, CLOUDFLARE_IPS_V6_URL, 6),
      ]);
      if (!v4 || !v6) {
        state.failedAt = Date.now();
        return false;
      }
      state.ranges = Object.freeze([...v4, ...v6]);
      state.fetchedAt = Date.now();
      return true;
    } catch {
      state.failedAt = Date.now();
      return false;
    } finally {
      state.inFlight = null;
    }
  })();
  state.inFlight = run;
  return run;
}

/**
 * Bieżąca lista zakresów — synchronicznie, bez czekania na sieć. Nieaktualna (albo brak) lista
 * uruchamia odświeżenie w tle; do jego końca obowiązuje ostatnia dobra lista albo zapas.
 */
export function cloudflareIpRanges(now: number = Date.now()): readonly string[] {
  const stale = !state.ranges || now - state.fetchedAt >= RANGES_TTL_MS;
  const backoff = state.failedAt > 0 && now - state.failedAt < RETRY_AFTER_ERROR_MS;
  if (stale && !backoff && !state.inFlight) void refreshCloudflareRanges();
  return state.ranges ?? CLOUDFLARE_IP_RANGES;
}

/** Tylko testy: stan początkowy (brak pobranej listy). */
export function resetCloudflareRangesForTests(): void {
  state.ranges = null;
  state.fetchedAt = 0;
  state.failedAt = 0;
  state.inFlight = null;
}

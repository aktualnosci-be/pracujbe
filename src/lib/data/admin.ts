/**
 * Warstwa danych panelu administratora — Pracuj.be (Etap 7g).
 *
 * ⚠️ ODCZYTY przez `withServiceRole()` (pula service_role, OMIJA RLS). Każda funkcja publiczna
 * SAMA potwierdza rolę `admin` sesji (`requireAdmin` → `getPortalIdentity()`) PRZED otwarciem
 * transakcji service_role — guard w `admin/layout.tsx` nie wystarcza (layout nie musi się
 * renderować razem ze stroną). Brak sesji, inna rola albo błąd odczytu tożsamości →
 * `notFound()` (fail closed, nie ujawniamy panelu).
 *
 * Zapytania to parametryzowany SQL (`@/lib/db/sql`, #25): listy stronicowane kursorem
 * (`created_at`, `id`) i wyszukiwanie ILIKE po stronie serwera. Jedna lista = jedna transakcja
 * — błąd któregokolwiek odczytu daje jawny stan `error` (#311), nie częściowe dane.
 *
 * Bez konfiguracji backendu (`isPortalDataConfigured() === false`) zwracamy dane DEMO —
 * dzięki temu panel renderuje się w podglądzie/buildzie bez bazy.
 */

import { notFound } from 'next/navigation';
import { cache } from 'react';

import {
  ADMIN_PAGE_SIZE,
  decodeAdminCursor,
  encodeAdminCursor,
  matchesSearch,
  normalizeAdminSearch,
  parseAuditAction,
  parseAuditEntity,
  parseBreachFilter,
  parseContactMessageFilter,
  parseEmailSuppressionFilter,
  parseReportFilter,
  parseReportKindFilter,
  parseScreeningReviewFilter,
  parseUserRoleFilter,
  parseUuid,
  parseYmd,
  reportStatusesFor,
} from '@/lib/admin/list-params';
import { appDayStartUtc } from '@/lib/datetime';
import { demoJobs } from '@/lib/data/demo';
import { getPortalIdentity, isPortalDataConfigured, withServiceRole } from '@/lib/db/portal';
import { attempt, queryCount, queryOne, queryRows } from '@/lib/db/sql';
import type { TransactionQuery } from '@/lib/db/transaction';
import { captureError } from '@/lib/sentry';
import {
  isScreeningQuestionType,
  toLocalizedText,
  type LocalizedText,
  type ScreeningQuestionType,
} from '@/lib/screening/questions';
import { isScreeningRiskCategory, type ScreeningRiskCategory } from '@/lib/screening/risk';
import {
  buildViesState,
  companyVatSource,
  type AdminViesState,
  type StoredViesCheck,
} from '@/lib/vies/state';

/* ---------------------------------------------------------------------------
 * Kontrakty dla UI
 * ------------------------------------------------------------------------- */

export interface AdminStats {
  /** Liczba firm (bez usuniętych). */
  companies: number;
  /**
   * Firmy czekające na decyzję admina: `unverified` + `pending` (#307). Nowa firma dostaje
   * `unverified` i nic w aplikacji nie przestawia jej na `pending`, więc liczymy oba statusy.
   */
  pendingCompanies: number;
  /** Liczba kont użytkowników (bez usuniętych). */
  users: number;
  /** Otwarte zgłoszenia (status `open`). */
  openReports: number;
}

export interface AdminCompanyRow {
  id: string;
  name: string;
  /** Surowy `company_status`: unverified/pending/verified/rejected/suspended. */
  status: string;
  /** ISO timestamp utworzenia albo null. */
  createdAt: string | null;
  /** Dane weryfikacyjne (#310) — null, gdy nieuzupełnione. */
  vatNumber: string | null;
  registrationNumber: string | null;
  email: string | null;
  city: string | null;
}

/** Wynik odczytu listy: błąd jest jawny, nie udaje pustej listy (#311). */
export type AdminListResult<T> =
  | {
      status: 'ok';
      rows: T[];
      /**
       * Token kursora następnej strony (`created_at`, `id`) albo null, gdy to ostatnia strona
       * (#418 — każda pozycja osiągalna, bez twardego limitu 200).
       */
      nextCursor: string | null;
    }
  | { status: 'error' };

/** Wspólne parametry list: fraza wyszukiwania i kursor z URL (niezaufane — walidowane). */
export interface AdminListQuery {
  q?: string | null;
  cursor?: string | null;
}

/** Wynik odczytu statystyk: błąd jest jawny, nie udaje zer (#311). */
export type AdminStatsResult = { status: 'ok'; stats: AdminStats } | { status: 'error' };

/** Statusy firm czekających na decyzję admina (kolejka weryfikacji, #307). */
export const AWAITING_COMPANY_STATUSES = ['unverified', 'pending'] as const;

/** Wartość filtra listy firm dla kolejki weryfikacji (`?status=awaiting`). */
export const AWAITING_FILTER = 'awaiting';

/** Link w panelu (ścieżka bez prefiksu locale — dokłada go next-intl `Link`). */
export interface AdminHref {
  pathname: string;
  query?: Record<string, string>;
}

/** Czego dotyczy zgłoszenie (#416): nazwa/tytuł celu, link albo bezpieczny podgląd. */
export interface AdminReportTarget {
  /** Nazwa firmy / tytuł oferty / imię i nazwisko użytkownika; null, gdy brak. */
  label: string | null;
  /** Link do celu (publiczna oferta, lista firm/użytkowników admina z wyszukiwaniem). */
  href: AdminHref | null;
  /** Podgląd treści zgłoszonej wiadomości (skrócony, tylko tekst). */
  preview: string | null;
  /** Cel usunięty (także miękko) albo nieistniejący. */
  deleted: boolean;
}

/** Zdarzenie historii sprawy DSA (`report_events`, 0094; decyzja/przywrócenie/flaga — 0099). */
export interface AdminReportEvent {
  type:
    | 'submitted'
    | 'status_changed'
    | 'decision'
    | 'restored'
    | 'flagged'
    | 'appeal_submitted'
    | 'appeal_decided'
    | 'redacted';
  toStatus: string | null;
  at: string;
}

const REPORT_EVENT_TYPES: readonly AdminReportEvent['type'][] = [
  'submitted',
  'status_changed',
  'decision',
  'restored',
  'flagged',
  'appeal_submitted',
  'appeal_decided',
  'redacted',
];

/** Decyzja moderacyjna w sprawie DSA (#42, `moderation_decisions`) — uzasadnienie. */
export interface AdminModerationDecision {
  id: string;
  reference: string;
  /** `no_action` | `job_removed` | `company_suspended`. */
  decision: string;
  facts: string;
  groundType: string | null;
  groundReference: string | null;
  automatedDetection: boolean;
  decidedAt: string;
  /** Cofnięcie ograniczenia (null = decyzja w mocy). */
  restoredAt: string | null;
  restoreReason: string | null;
}

/**
 * Sprawa z publicznego formularza zgłoszeń treści (#41, `reports.kind = 'dsa_notice'`).
 * Dowód (`snapshot*`) to stan treści w chwili zgłoszenia — niezależny od późniejszej zmiany
 * lub usunięcia oferty. Kontakt zgłaszającego widzi wyłącznie administrator.
 */
export interface AdminDsaCase {
  caseNumber: string;
  dueAt: string | null;
  contentUrl: string | null;
  reporterEmail: string | null;
  snapshotJobTitle: string | null;
  snapshotCompanyName: string | null;
  events: AdminReportEvent[];
  /** Priorytet kolejki przeglądu 0–3 i flaga automatu (#42 — tylko podpowiedź, nie decyzja). */
  reviewPriority: number;
  reviewFlag: string | null;
  decision: AdminModerationDecision | null;
}

export interface AdminReportRow {
  id: string;
  /** Sprawa DSA (#41) albo null dla zwykłego zgłoszenia. */
  dsa: AdminDsaCase | null;
  /** `report_target_type`: job/company/user/message. */
  targetType: string;
  targetId: string;
  target: AdminReportTarget;
  reason: string;
  details: string | null;
  /** `report_status`: open/reviewing/resolved/dismissed. */
  status: string;
  /** Nazwa zgłaszającego albo null (konto usunięte / brak imienia). */
  reporterName: string | null;
  createdAt: string | null;
}

export interface AdminUserRow {
  id: string;
  /** Imię i nazwisko sklejone (może być puste). */
  name: string;
  email: string | null;
  /** `user_role`: candidate/employer/admin/moderator. */
  role: string;
  createdAt: string | null;
}

/** Filtry listy zgłoszeń. */
export interface AdminReportsQuery {
  /** Wartość z URL (`active` domyślnie = otwarte + w analizie). */
  status?: string | null;
  /** Rodzaj zgłoszenia z URL (`all` domyślnie, `dsa_notice`, `quality`). */
  kind?: string | null;
  cursor?: string | null;
}

/** Filtry listy użytkowników. */
export interface AdminUsersQuery extends AdminListQuery {
  role?: string | null;
}

/** Filtry listy firm. */
export interface AdminCompaniesQuery extends AdminListQuery {
  /** Status firmy albo `awaiting`/`all`. */
  status?: string | null;
}

/* ---------------------------------------------------------------------------
 * Dane DEMO (fallback bez env)
 * ------------------------------------------------------------------------- */

const DEMO_STATS: AdminStats = {
  companies: 12,
  pendingCompanies: 4,
  users: 148,
  openReports: 3,
};

const DEMO_COMPANIES: AdminCompanyRow[] = [
  { id: 'demo-c1', name: 'AGO Jobs & HR', status: 'verified', createdAt: '2025-01-15T09:00:00.000Z', vatNumber: 'BE0123456789', registrationNumber: '0123.456.789', email: 'jobs@example.com', city: 'Antwerpen' },
  { id: 'demo-c2', name: 'Bouwbedrijf De Vos', status: 'pending', createdAt: '2025-02-03T11:30:00.000Z', vatNumber: 'BE0987654321', registrationNumber: null, email: 'info@example.com', city: 'Gent' },
  { id: 'demo-c3', name: 'Logistiek Antwerpen NV', status: 'pending', createdAt: '2025-02-10T08:15:00.000Z', vatNumber: 'BE0417497106', registrationNumber: null, email: null, city: null },
  { id: 'demo-c4', name: 'Horeca Brussel Group', status: 'unverified', createdAt: '2025-02-18T14:45:00.000Z', vatNumber: null, registrationNumber: null, email: null, city: null },
  { id: 'demo-c5', name: 'CleanPro Services', status: 'rejected', createdAt: '2025-01-28T10:00:00.000Z', vatNumber: null, registrationNumber: null, email: null, city: null },
  { id: 'demo-c6', name: 'TransEuro Trucking', status: 'suspended', createdAt: '2024-12-11T16:20:00.000Z', vatNumber: null, registrationNumber: null, email: null, city: null },
  { id: 'demo-c7', name: 'Flanders Food Factory', status: 'pending', createdAt: '2025-02-20T09:05:00.000Z', vatNumber: null, registrationNumber: null, email: null, city: null },
];

const DEMO_REPORTS: AdminReportRow[] = [
  {
    id: 'demo-r0',
    dsa: {
      caseNumber: 'DSA-7F3A-19C2-B4E0-5D11',
      dueAt: '2025-02-28T09:00:00.000Z',
      contentUrl: demoJobs[1] ? `https://pracuj.be/pl/oferty-pracy/${demoJobs[1].slug}` : null,
      reporterEmail: 'zglaszajacy@example.com',
      snapshotJobTitle: demoJobs[1]?.title ?? null,
      snapshotCompanyName: demoJobs[1]?.companyName ?? null,
      events: [{ type: 'submitted', toStatus: 'open', at: '2025-02-21T09:00:00.000Z' }],
      reviewPriority: 0,
      reviewFlag: null,
      decision: null,
    },
    targetType: 'job',
    targetId: 'demo-job-2',
    target: {
      label: demoJobs[1]?.title ?? null,
      href: demoJobs[1] ? { pathname: `/oferty-pracy/${demoJobs[1].slug}` } : null,
      preview: null,
      deleted: false,
    },
    reason: 'fraud',
    details: 'Ogłoszenie wymaga wpłaty za „rezerwację miejsca pracy” przed rozmową.',
    status: 'open',
    reporterName: null,
    createdAt: '2025-02-21T09:00:00.000Z',
  },
  {
    id: 'demo-r1',
    dsa: null,
    targetType: 'job',
    targetId: 'demo-job-1',
    target: {
      label: demoJobs[0]?.title ?? null,
      href: demoJobs[0] ? { pathname: `/oferty-pracy/${demoJobs[0].slug}` } : null,
      preview: null,
      deleted: false,
    },
    reason: 'spam',
    details: 'Oferta wygląda na duplikat i zawiera link do zewnętrznego formularza.',
    status: 'open',
    reporterName: 'Adam Kowalski',
    createdAt: '2025-02-19T12:00:00.000Z',
  },
  {
    id: 'demo-r2',
    dsa: null,
    targetType: 'company',
    targetId: 'demo-c6',
    target: {
      label: 'TransEuro Trucking',
      href: { pathname: '/admin/firmy', query: { q: 'TransEuro Trucking' } },
      preview: null,
      deleted: false,
    },
    reason: 'misleading',
    details: null,
    status: 'open',
    reporterName: 'Marta Nowak',
    createdAt: '2025-02-15T18:30:00.000Z',
  },
  {
    id: 'demo-r3',
    dsa: null,
    targetType: 'message',
    targetId: 'demo-msg-9',
    target: {
      label: null,
      href: null,
      preview: 'Odpowiedz od razu albo zapomnij o tej pracy.',
      deleted: false,
    },
    reason: 'harassment',
    details: 'Niestosowne treści w wiadomości do kandydata.',
    status: 'reviewing',
    reporterName: null,
    createdAt: '2025-02-08T07:45:00.000Z',
  },
];

const DEMO_USERS: AdminUserRow[] = [
  { id: 'demo-u1', name: 'Adam Kowalski', email: 'adam.kowalski@example.com', role: 'candidate', createdAt: '2025-01-05T09:00:00.000Z' },
  { id: 'demo-u2', name: 'Marta Nowak', email: 'marta.nowak@example.com', role: 'candidate', createdAt: '2025-01-12T10:30:00.000Z' },
  { id: 'demo-u3', name: 'Jan Peeters', email: 'jan.peeters@ago.be', role: 'employer', createdAt: '2025-01-15T08:45:00.000Z' },
  { id: 'demo-u4', name: 'Sophie Dubois', email: 'sophie.dubois@example.com', role: 'employer', createdAt: '2025-02-01T13:20:00.000Z' },
  { id: 'demo-u5', name: 'Zespół Pracuj.be', email: 'admin@pracuj.be', role: 'admin', createdAt: '2024-11-01T00:00:00.000Z' },
];

/* ---------------------------------------------------------------------------
 * Pomocnicze parsowanie (wiersze JSON z bazy są nietypowane — zawężamy bez `any`)
 * ------------------------------------------------------------------------- */

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return v.length > 0 ? v : null;
}

function asRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

/** Sklejone imię i nazwisko (puste, gdy brak obu). */
function fullName(row: Record<string, unknown>): string {
  return [asString(row['first_name']), asString(row['last_name'])]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(' ');
}

/** Filtr statusu dla listy DEMO (`all`/undefined → wszystko). */
function filterDemoCompanies(filter?: string): AdminCompanyRow[] {
  if (!filter || filter === 'all') return DEMO_COMPANIES;
  if (filter === AWAITING_FILTER) {
    return DEMO_COMPANIES.filter((c) =>
      (AWAITING_COMPANY_STATUSES as readonly string[]).includes(c.status),
    );
  }
  return DEMO_COMPANIES.filter((c) => c.status === filter);
}

/** Lista DEMO: bez stronicowania (kilka wierszy). */
function demoList<T>(rows: T[]): AdminListResult<T> {
  return { status: 'ok', rows, nextCursor: null };
}

/**
 * Strona listy: pobieramy `ADMIN_PAGE_SIZE + 1`, nadmiarowy wiersz oznacza, że jest następna
 * strona — kursor = ostatni pokazany wiersz (sortowanie `created_at desc, id desc`).
 */
function toPage<T extends { id: string }>(
  rows: T[],
  createdAtOf: (row: T) => string | null,
): AdminListResult<T> {
  const page = rows.slice(0, ADMIN_PAGE_SIZE);
  const last = page[page.length - 1];
  const lastCreatedAt = last ? createdAtOf(last) : null;
  const nextCursor =
    rows.length > ADMIN_PAGE_SIZE && last && lastCreatedAt
      ? encodeAdminCursor({ createdAt: lastCreatedAt, id: last.id })
      : null;
  return { status: 'ok', rows: page, nextCursor };
}

/**
 * Potwierdza rolę `admin` bieżącej sesji (tożsamość z `getPortalIdentity()`). Wynik
 * zapamiętany na czas jednego żądania (`cache`), więc kilka odczytów strony = jedno sprawdzenie.
 */
const isAdminSession = cache(async (): Promise<boolean> => {
  try {
    // `getPortalIdentity()` = zweryfikowana sesja + rola z profilu (już sprawdzona w bazie).
    const me = await getPortalIdentity();
    return me?.role === 'admin';
  } catch (error) {
    captureError(error, { area: 'admin.requireAdmin' });
    return false;
  }
});

/** Bez roli admina → `notFound()` (rzuca). Wołane przed każdym odczytem service-role. */
export async function requireAdmin(): Promise<void> {
  if (!(await isAdminSession())) notFound();
}

/* ---------------------------------------------------------------------------
 * Budowanie warunków SQL (wartości zawsze w parametrach `$n`)
 * ------------------------------------------------------------------------- */

/** Zbiera parametry zapytania i zwraca ich znaczniki `$n`. */
class SqlParams {
  readonly values: unknown[] = [];

  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

/**
 * Warunek „starsze niż kursor” dla sortowania `created_at desc, id desc` (porównanie
 * wierszowe = `created_at < ts OR (created_at = ts AND id < id)`). Zły token = brak warunku
 * (pierwsza strona). Znacznik czasu przechodzi do bazy tekstem — pełna precyzja mikrosekund.
 */
function cursorCondition(params: SqlParams, token: string | null | undefined, alias = ''): string | null {
  const cursor = decodeAdminCursor(token);
  if (!cursor) return null;
  const prefix = alias ? `${alias}.` : '';
  return `(${prefix}created_at, ${prefix}id) < (${params.add(cursor.createdAt)}::timestamptz, ${params.add(cursor.id)}::uuid)`;
}

/**
 * Fraza (już znormalizowana przez `normalizeAdminSearch` — bez `%`, `*`, `\`) w dowolnej
 * z kolumn (ILIKE). `_` escapujemy, żeby był literałem, a nie symbolem wieloznacznym LIKE.
 */
function searchCondition(params: SqlParams, columns: readonly string[], q: string): string {
  const pattern = params.add(`%${q.replace(/_/g, '\\_')}%`);
  return `(${columns.map((column) => `${column}::text ILIKE ${pattern}`).join(' OR ')})`;
}

/** `WHERE …` z niepustych warunków (albo pusty string). */
function whereOf(conditions: Array<string | null | false | undefined>): string {
  const present = conditions.filter((c): c is string => typeof c === 'string' && c.length > 0);
  return present.length ? `WHERE ${present.join(' AND ')}` : '';
}

/** Unikalne, niepuste identyfikatory. */
function uniqueIds(values: string[]): string[] {
  return [...new Set(values.filter((v) => v.length > 0))];
}

/** Imiona i nazwiska profili po id (batch, bez N+1). */
async function readProfileNames(
  tx: TransactionQuery,
  name: string,
  ids: string[],
): Promise<Record<string, unknown>[]> {
  if (ids.length === 0) return [];
  return queryRows(
    tx,
    name,
    'SELECT id, first_name, last_name, email FROM public.profiles WHERE id = ANY($1::uuid[])',
    [ids],
  );
}

/* ---------------------------------------------------------------------------
 * Publiczne API
 * ------------------------------------------------------------------------- */

/** Kafelki statystyk dashboardu admina. Bez env → dane DEMO. Błąd dowolnego licznika → `error`. */
export async function getAdminStats(): Promise<AdminStatsResult> {
  if (!isPortalDataConfigured()) return { status: 'ok', stats: DEMO_STATS };
  await requireAdmin();

  try {
    const stats = await withServiceRole(async (tx) => ({
      companies: await queryCount(tx, 'admin.stats-companies',
        'SELECT 1 FROM public.companies WHERE deleted_at IS NULL'),
      pendingCompanies: await queryCount(tx, 'admin.stats-pending-companies',
        'SELECT 1 FROM public.companies WHERE deleted_at IS NULL AND status::text = ANY($1::text[])',
        [[...AWAITING_COMPANY_STATUSES]]),
      users: await queryCount(tx, 'admin.stats-users',
        'SELECT 1 FROM public.profiles WHERE deleted_at IS NULL'),
      openReports: await queryCount(tx, 'admin.stats-open-reports',
        "SELECT 1 FROM public.reports WHERE status = 'open'"),
    }));
    return { status: 'ok', stats };
  } catch (error) {
    captureError(error, { area: 'admin.getAdminStats' });
    return { status: 'error' };
  }
}

/**
 * Lista firm (#418): filtr statusu (`awaiting` = kolejka weryfikacji), wyszukiwanie po nazwie,
 * VAT, KBO i e-mailu, stronicowanie kursorem. Bez env → DEMO.
 */
export async function listCompanies(
  query: AdminCompaniesQuery = {},
): Promise<AdminListResult<AdminCompanyRow>> {
  const filter = query.status ?? undefined;
  const q = normalizeAdminSearch(query.q);
  if (!isPortalDataConfigured()) {
    return demoList(
      filterDemoCompanies(filter).filter((c) =>
        matchesSearch([c.name, c.vatNumber, c.registrationNumber, c.email], q),
      ),
    );
  }
  await requireAdmin();

  try {
    const params = new SqlParams();
    const statuses =
      filter === AWAITING_FILTER
        ? [...AWAITING_COMPANY_STATUSES]
        : filter && filter !== 'all'
          ? [filter]
          : null;
    const where = whereOf([
      'deleted_at IS NULL',
      statuses && `status::text = ANY(${params.add(statuses)}::text[])`,
      q && searchCondition(params, ['name', 'vat_number', 'registration_number', 'email'], q),
      cursorCondition(params, query.cursor),
    ]);
    const limit = params.add(ADMIN_PAGE_SIZE + 1);
    const data = await withServiceRole((tx) =>
      queryRows(tx, 'admin.companies',
        `SELECT id, name, status, created_at, vat_number, registration_number, email, city
           FROM public.companies
           ${where}
          ORDER BY created_at DESC, id DESC
          LIMIT ${limit}`, params.values),
    );

    return toPage(
      asRows(data).map((row) => ({
        id: asString(row['id']),
        name: asString(row['name']),
        status: asString(row['status'], 'unverified'),
        createdAt: asNullableString(row['created_at']),
        vatNumber: asNullableString(row['vat_number']),
        registrationNumber: asNullableString(row['registration_number']),
        email: asNullableString(row['email']),
        city: asNullableString(row['city']),
      })),
      (row) => row.createdAt,
    );
  } catch (error) {
    captureError(error, { area: 'admin.listCompanies' });
    return { status: 'error' };
  }
}

/** Maks. długość podglądu zgłoszonej wiadomości. */
const MESSAGE_PREVIEW_MAX = 280;

/** Cel nieodnaleziony albo usunięty. */
const DELETED_TARGET: AdminReportTarget = { label: null, href: null, preview: null, deleted: true };

/**
 * Cele zgłoszeń (#416) — jeden batchowy odczyt na typ (bez N+1). Błąd któregokolwiek odczytu
 * rzuca (lista zgłoszeń bez celów = rozstrzyganie na ślepo, więc to błąd, nie pusta treść).
 */
async function loadReportTargets(
  tx: TransactionQuery,
  rows: Record<string, unknown>[],
): Promise<Map<string, AdminReportTarget>> {
  const idsOf = (type: string) =>
    uniqueIds(
      rows.filter((r) => asString(r['target_type']) === type).map((r) => asString(r['target_id'])),
    );
  const targets = new Map<string, AdminReportTarget>();
  const key = (type: string, id: string) => `${type}:${id}`;

  const jobIds = idsOf('job');
  const companyIds = idsOf('company');
  const userIds = idsOf('user');
  const messageIds = idsOf('message');

  // Sekwencyjnie na jednej transakcji; `id::text` — cel spoza formatu UUID po prostu nie pasuje.
  const jobs = jobIds.length
    ? await queryRows(tx, 'admin.report-target-jobs',
        'SELECT id, title, slug, status, deleted_at FROM public.jobs WHERE id::text = ANY($1::text[])',
        [jobIds])
    : [];
  const companies = companyIds.length
    ? await queryRows(tx, 'admin.report-target-companies',
        'SELECT id, name, deleted_at FROM public.companies WHERE id::text = ANY($1::text[])',
        [companyIds])
    : [];
  const users = userIds.length
    ? await queryRows(tx, 'admin.report-target-users',
        'SELECT id, first_name, last_name, email, deleted_at FROM public.profiles WHERE id::text = ANY($1::text[])',
        [userIds])
    : [];
  const messages = messageIds.length
    ? await queryRows(tx, 'admin.report-target-messages',
        'SELECT id, body, deleted_at FROM public.messages WHERE id::text = ANY($1::text[])',
        [messageIds])
    : [];

  for (const job of asRows(jobs)) {
    if (asNullableString(job['deleted_at'])) continue;
    const slug = asNullableString(job['slug']);
    targets.set(key('job', asString(job['id'])), {
      label: asNullableString(job['title']),
      // Link publiczny tylko do aktywnej oferty — inna nie ma strony publicznej.
      href:
        slug && asString(job['status']) === 'active'
          ? { pathname: `/oferty-pracy/${slug}` }
          : null,
      preview: null,
      deleted: false,
    });
  }
  for (const company of asRows(companies)) {
    if (asNullableString(company['deleted_at'])) continue;
    const name = asNullableString(company['name']);
    targets.set(key('company', asString(company['id'])), {
      label: name,
      href: name ? { pathname: '/admin/firmy', query: { q: name } } : null,
      preview: null,
      deleted: false,
    });
  }
  for (const user of asRows(users)) {
    if (asNullableString(user['deleted_at'])) continue;
    const name = fullName(user);
    const email = asNullableString(user['email']);
    const search = email ?? (name.length > 0 ? name : null);
    targets.set(key('user', asString(user['id'])), {
      label: name.length > 0 ? name : email,
      href: search ? { pathname: '/admin/uzytkownicy', query: { q: search } } : null,
      preview: null,
      deleted: false,
    });
  }
  for (const message of asRows(messages)) {
    if (asNullableString(message['deleted_at'])) continue;
    const body = asString(message['body']).replace(/\s+/g, ' ').trim();
    targets.set(key('message', asString(message['id'])), {
      label: null,
      href: null,
      preview:
        body.length > MESSAGE_PREVIEW_MAX ? `${body.slice(0, MESSAGE_PREVIEW_MAX - 1)}…` : body,
      deleted: false,
    });
  }

  return new Map(
    rows.map((r) => {
      const k = key(asString(r['target_type']), asString(r['target_id']));
      return [k, targets.get(k) ?? DELETED_TARGET];
    }),
  );
}

interface ReportPageData {
  rows: Record<string, unknown>[];
  nameById: Map<string, string>;
  eventsById: Map<string, AdminReportEvent[]>;
  decisionById: Map<string, AdminModerationDecision>;
  targets: Map<string, AdminReportTarget>;
}

/** Strona zgłoszeń i dane pomocnicze (zgłaszający, historia DSA, decyzje, cele) w jednej transakcji. */
async function readReportPage(
  tx: TransactionQuery,
  statuses: string[] | null,
  kind: string,
  cursorToken: string | null | undefined,
): Promise<ReportPageData> {
  const params = new SqlParams();
  const where = whereOf([
    statuses && `status::text = ANY(${params.add(statuses)}::text[])`,
    kind !== 'all' && `kind = ${params.add(kind)}`,
    cursorCondition(params, cursorToken),
  ]);
  const limit = params.add(ADMIN_PAGE_SIZE + 1);
  const rows = asRows(
    await queryRows(tx, 'admin.reports',
      `SELECT id, reporter_id, target_type, target_id, reason, details, status, created_at, kind,
              case_number, due_at, content_url, reporter_name, reporter_email, target_snapshot,
              decision_id, review_priority, review_flag
         FROM public.reports
         ${where}
        ORDER BY created_at DESC, id DESC
        LIMIT ${limit}`, params.values),
  );

  // Nazwy zgłaszających — jeden batchowy odczyt po unikalnych id (unikamy N+1).
  const nameById = new Map<string, string>();
  const reporterIds = uniqueIds(rows.map((r) => asString(r['reporter_id'])));
  for (const profile of asRows(await readProfileNames(tx, 'admin.report-reporters', reporterIds))) {
    nameById.set(asString(profile['id']), fullName(profile));
  }

  // Historia spraw DSA (#41) — jeden odczyt dla całej strony.
  const dsaIds = rows.filter((r) => asString(r['kind']) === 'dsa_notice').map((r) => asString(r['id']));
  const eventsById = new Map<string, AdminReportEvent[]>();
  if (dsaIds.length > 0) {
    const events = await queryRows(tx, 'admin.report-events',
      `SELECT report_id, event_type, to_status, created_at
         FROM public.report_events
        WHERE report_id = ANY($1::uuid[])
        ORDER BY id ASC`, [dsaIds]);
    for (const event of asRows(events)) {
      const type = REPORT_EVENT_TYPES.find((t) => t === asString(event['event_type']));
      if (!type) continue;
      const list = eventsById.get(asString(event['report_id'])) ?? [];
      list.push({
        type,
        toStatus: asNullableString(event['to_status']),
        at: asString(event['created_at']),
      });
      eventsById.set(asString(event['report_id']), list);
    }
  }

  // Decyzje moderacyjne (#42) i ich przywrócenia — jeden odczyt na stronę.
  const decisionIds = uniqueIds(rows.map((r) => asString(r['decision_id'])));
  const decisionById = new Map<string, AdminModerationDecision>();
  if (decisionIds.length > 0) {
    const decisions = await queryRows(tx, 'admin.report-decisions',
      `SELECT id, reference, decision, facts, ground_type, ground_reference, automated_detection, decided_at
         FROM public.moderation_decisions
        WHERE id = ANY($1::uuid[])`, [decisionIds]);
    const restorations = await queryRows(tx, 'admin.report-restorations',
      `SELECT decision_id, reason, restored_at
         FROM public.moderation_restorations
        WHERE decision_id = ANY($1::uuid[])`, [decisionIds]);
    const restoredBy = new Map(asRows(restorations).map((r) => [asString(r['decision_id']), r]));
    for (const d of asRows(decisions)) {
      const id = asString(d['id']);
      const restoration = restoredBy.get(id);
      decisionById.set(id, {
        id,
        reference: asString(d['reference']),
        decision: asString(d['decision']),
        facts: asString(d['facts']),
        groundType: asNullableString(d['ground_type']),
        groundReference: asNullableString(d['ground_reference']),
        automatedDetection: d['automated_detection'] === true,
        decidedAt: asString(d['decided_at']),
        restoredAt: restoration ? asNullableString(restoration['restored_at']) : null,
        restoreReason: restoration ? asNullableString(restoration['reason']) : null,
      });
    }
  }

  const targets = await loadReportTargets(tx, rows);
  return { rows, nameById, eventsById, decisionById, targets };
}

/**
 * Lista zgłoszeń (#416): filtr statusu (domyślnie otwarte + w analizie), cel zgłoszenia, nazwa
 * zgłaszającego, stronicowanie kursorem (#418). Bez env → DEMO.
 */
export async function listReports(
  query: AdminReportsQuery = {},
): Promise<AdminListResult<AdminReportRow>> {
  const statuses = reportStatusesFor(parseReportFilter(query.status));
  const kind = parseReportKindFilter(query.kind);
  if (!isPortalDataConfigured()) {
    return demoList(
      DEMO_REPORTS.filter(
        (r) =>
          (!statuses || statuses.includes(r.status)) &&
          (kind === 'all' || (kind === 'dsa_notice') === (r.dsa !== null)),
      ),
    );
  }
  await requireAdmin();

  try {
    const { rows, nameById, eventsById, decisionById, targets } = await withServiceRole((tx) =>
      readReportPage(tx, statuses, kind, query.cursor),
    );

    return toPage(
      rows.map((row) => {
        const id = asString(row['id']);
        const reporterId = asString(row['reporter_id']);
        const profileName = reporterId ? (nameById.get(reporterId) ?? '') : '';
        const givenName = asNullableString(row['reporter_name']) ?? '';
        const name = profileName.length > 0 ? profileName : givenName;
        const targetType = asString(row['target_type']);
        const targetId = asString(row['target_id']);
        const isDsa = asString(row['kind']) === 'dsa_notice';
        const snapshot = (row['target_snapshot'] ?? null) as {
          job?: { title?: unknown };
          company?: { name?: unknown };
        } | null;
        return {
          id,
          dsa: isDsa
            ? {
                caseNumber: asString(row['case_number']),
                dueAt: asNullableString(row['due_at']),
                contentUrl: asNullableString(row['content_url']),
                reporterEmail: asNullableString(row['reporter_email']),
                snapshotJobTitle: asNullableString(snapshot?.job?.title),
                snapshotCompanyName: asNullableString(snapshot?.company?.name),
                events: eventsById.get(id) ?? [],
                reviewPriority: Number(row['review_priority'] ?? 0) || 0,
                reviewFlag: asNullableString(row['review_flag']),
                decision: decisionById.get(asString(row['decision_id'])) ?? null,
              }
            : null,
          targetType,
          targetId,
          target: targets.get(`${targetType}:${targetId}`) ?? DELETED_TARGET,
          reason: asString(row['reason']),
          details: asNullableString(row['details']),
          status: asString(row['status'], 'open'),
          reporterName: name.length > 0 ? name : null,
          createdAt: asNullableString(row['created_at']),
        };
      }),
      (row) => row.createdAt,
    );
  } catch (error) {
    captureError(error, { area: 'admin.listReports' });
    return { status: 'error' };
  }
}

/**
 * Lista kont użytkowników (tylko odczyt, #418): wyszukiwanie po imieniu, nazwisku i e-mailu,
 * filtr roli, stronicowanie kursorem. Bez env → DEMO.
 */
export async function listUsers(
  query: AdminUsersQuery = {},
): Promise<AdminListResult<AdminUserRow>> {
  const q = normalizeAdminSearch(query.q);
  const role = parseUserRoleFilter(query.role);
  if (!isPortalDataConfigured()) {
    return demoList(
      DEMO_USERS.filter(
        (u) => (!role || u.role === role) && matchesSearch([u.name, u.email], q),
      ),
    );
  }
  await requireAdmin();

  try {
    const params = new SqlParams();
    const where = whereOf([
      'deleted_at IS NULL',
      role && `role::text = ${params.add(role)}`,
      q && searchCondition(params, ['first_name', 'last_name', 'email'], q),
      cursorCondition(params, query.cursor),
    ]);
    const limit = params.add(ADMIN_PAGE_SIZE + 1);
    const data = await withServiceRole((tx) =>
      queryRows(tx, 'admin.users',
        `SELECT id, first_name, last_name, email, role, created_at
           FROM public.profiles
           ${where}
          ORDER BY created_at DESC, id DESC
          LIMIT ${limit}`, params.values),
    );

    return toPage(
      asRows(data).map((row) => ({
        id: asString(row['id']),
        name: fullName(row),
        email: asNullableString(row['email']),
        role: asString(row['role'], 'candidate'),
        createdAt: asNullableString(row['created_at']),
      })),
      (row) => row.createdAt,
    );
  } catch (error) {
    captureError(error, { area: 'admin.listUsers' });
    return { status: 'error' };
  }
}

/* ---------------------------------------------------------------------------
 * Dziennik zdarzeń (audit_logs) — tylko odczyt (#417)
 * ------------------------------------------------------------------------- */

export interface AdminAuditRow {
  id: string;
  /** Surowa akcja (`company.status_changed` …) — UI mapuje na etykietę i18n. */
  action: string;
  /** `company`/`report`/`application`/`offer` albo null. */
  entityType: string | null;
  entityId: string | null;
  /** Nazwa obiektu (firma) albo null, gdy brak/nieznana. */
  entityLabel: string | null;
  /** Link do obiektu w panelu admina albo null. */
  entityHref: AdminHref | null;
  /** Status przed/po (surowe wartości enumów) — UI tłumaczy wg typu obiektu. */
  statusBefore: string | null;
  statusAfter: string | null;
  /** Uzasadnienie decyzji admina (odrzucenie/zawieszenie firmy, 0084 — #310) albo null. */
  reason: string | null;
  /** Aktor: null = system/usługa (brak `auth.uid()`). */
  actorId: string | null;
  actorName: string | null;
  createdAt: string | null;
}

export interface AdminAuditQuery {
  entity?: string | null;
  action?: string | null;
  /** Historia jednego obiektu (`entity_id`). */
  entityId?: string | null;
  /** Aktor: fraza (imię/nazwisko/e-mail) albo `system`. */
  actor?: string | null;
  /** Zakres dat `YYYY-MM-DD` (włącznie) w Europe/Brussels. */
  from?: string | null;
  to?: string | null;
  cursor?: string | null;
}

/** Słowo kluczowe filtra aktora: wpisy bez aktora (trigger/usługa). */
export const AUDIT_ACTOR_SYSTEM = 'system';

const DEMO_AUDIT: AdminAuditRow[] = [
  {
    id: 'demo-a1',
    action: 'company.status_changed',
    entityType: 'company',
    entityId: 'demo-c1',
    entityLabel: 'AGO Jobs & HR',
    entityHref: { pathname: '/admin/firmy', query: { q: 'AGO Jobs & HR' } },
    statusBefore: 'pending',
    statusAfter: 'verified',
    reason: null,
    actorId: 'demo-u5',
    actorName: 'Zespół Pracuj.be',
    createdAt: '2025-02-19T12:00:00.000Z',
  },
  {
    id: 'demo-a2',
    action: 'report.resolved',
    entityType: 'report',
    entityId: 'demo-r3',
    entityLabel: null,
    entityHref: { pathname: '/admin/zgloszenia', query: { status: 'all' } },
    statusBefore: 'open',
    statusAfter: 'reviewing',
    reason: null,
    actorId: 'demo-u5',
    actorName: 'Zespół Pracuj.be',
    createdAt: '2025-02-10T09:30:00.000Z',
  },
  {
    id: 'demo-a3',
    action: 'company.created',
    entityType: 'company',
    entityId: 'demo-c4',
    entityLabel: 'Horeca Brussel Group',
    entityHref: { pathname: '/admin/firmy', query: { q: 'Horeca Brussel Group' } },
    statusBefore: null,
    statusAfter: 'unverified',
    reason: null,
    actorId: null,
    actorName: null,
    createdAt: '2025-02-18T14:45:00.000Z',
  },
];

function statusOf(value: unknown): string | null {
  return asNullableString(asRecord(value)['status']);
}

/**
 * Dziennik zdarzeń: filtry typu obiektu, akcji, obiektu, aktora i zakresu dat; stronicowanie
 * kursorem (`created_at`, `id`). Nazwy aktorów i firm — batchowe odczyty. Bez env → DEMO.
 */
export async function listAuditLogs(
  query: AdminAuditQuery = {},
): Promise<AdminListResult<AdminAuditRow>> {
  const entity = parseAuditEntity(query.entity);
  const action = parseAuditAction(query.action);
  const entityId = parseUuid(query.entityId);
  const actorQuery = normalizeAdminSearch(query.actor);
  const fromIso = appDayStartUtc(parseYmd(query.from));
  const toIso = appDayStartUtc(parseYmd(query.to), true);

  if (!isPortalDataConfigured()) {
    return demoList(
      DEMO_AUDIT.filter(
        (row) =>
          (!entity || row.entityType === entity) &&
          (!action || row.action === action) &&
          (!actorQuery ||
            (actorQuery.toLowerCase() === AUDIT_ACTOR_SYSTEM
              ? row.actorId === null
              : matchesSearch([row.actorName], actorQuery))),
      ),
    );
  }
  await requireAdmin();

  try {
    const systemActor = actorQuery?.toLowerCase() === AUDIT_ACTOR_SYSTEM;
    const page = await withServiceRole(async (tx) => {
      // Aktor po nazwie/e-mailu → id profili (max 100 dopasowań); brak dopasowań = pusta lista.
      let actorIdsFilter: string[] | null = null;
      if (actorQuery && !systemActor) {
        const actorParams = new SqlParams();
        const actors = await queryRows(tx, 'admin.audit-actor-search',
          `SELECT id FROM public.profiles
            ${whereOf([searchCondition(actorParams, ['first_name', 'last_name', 'email'], actorQuery)])}
            LIMIT 100`, actorParams.values);
        actorIdsFilter = uniqueIds(asRows(actors).map((r) => asString(r['id'])));
        if (actorIdsFilter.length === 0) return null;
      }

      const params = new SqlParams();
      const where = whereOf([
        entity && `entity_type = ${params.add(entity)}`,
        action && `action = ${params.add(action)}`,
        entityId && `entity_id = ${params.add(entityId)}::uuid`,
        fromIso && `created_at >= ${params.add(fromIso)}::timestamptz`,
        toIso && `created_at < ${params.add(toIso)}::timestamptz`,
        systemActor && 'actor_id IS NULL',
        actorIdsFilter && `actor_id = ANY(${params.add(actorIdsFilter)}::uuid[])`,
        cursorCondition(params, query.cursor),
      ]);
      const limit = params.add(ADMIN_PAGE_SIZE + 1);
      const rows = asRows(
        await queryRows(tx, 'admin.audit-logs',
          `SELECT id, actor_id, action, entity_type, entity_id, before_data, after_data, created_at
             FROM public.audit_logs
             ${where}
            ORDER BY created_at DESC, id DESC
            LIMIT ${limit}`, params.values),
      );

      const actorIds = uniqueIds(rows.map((r) => asString(r['actor_id'])));
      const companyIds = uniqueIds(
        rows.filter((r) => asString(r['entity_type']) === 'company').map((r) => asString(r['entity_id'])),
      );
      const actors = await readProfileNames(tx, 'admin.audit-actors', actorIds);
      const companies = companyIds.length
        ? await queryRows(tx, 'admin.audit-companies',
            'SELECT id, name, deleted_at FROM public.companies WHERE id = ANY($1::uuid[])', [companyIds])
        : [];
      return { rows, actors: asRows(actors), companies: asRows(companies) };
    });
    if (!page) return { status: 'ok', rows: [], nextCursor: null };

    const actorName = new Map<string, string | null>();
    for (const p of page.actors) {
      const name = fullName(p);
      actorName.set(asString(p['id']), name.length > 0 ? name : asNullableString(p['email']));
    }
    const companyName = new Map<string, { name: string | null; deleted: boolean }>();
    for (const c of page.companies) {
      companyName.set(asString(c['id']), {
        name: asNullableString(c['name']),
        deleted: Boolean(asNullableString(c['deleted_at'])),
      });
    }

    return toPage(
      page.rows.map((row) => {
        const entityType = asNullableString(row['entity_type']);
        const id = asNullableString(row['entity_id']);
        const actorId = asNullableString(row['actor_id']);
        let entityLabel: string | null = null;
        let entityHref: AdminHref | null = null;
        if (entityType === 'company' && id) {
          const company = companyName.get(id);
          entityLabel = company?.name ?? null;
          if (company?.name && !company.deleted) {
            const uuid = parseUuid(id);
            // Szczegół firmy (#310); identyfikator spoza formatu UUID → wyszukiwanie po nazwie.
            entityHref = uuid
              ? { pathname: `/admin/firmy/${uuid}` }
              : { pathname: '/admin/firmy', query: { q: company.name } };
          }
        } else if (entityType === 'report') {
          entityHref = { pathname: '/admin/zgloszenia', query: { status: 'all' } };
        } else if (entityType === 'email_suppression') {
          entityHref = { pathname: '/admin/poczta', query: { status: 'all' } };
        } else if (entityType === 'screening_question_review') {
          entityHref = { pathname: '/admin/pytania', query: { status: 'all' } };
        } else if (entityType === 'breach_incident' && id) {
          const uuid = parseUuid(id);
          entityHref = uuid ? { pathname: `/admin/naruszenia/${uuid}` } : null;
        } else if (entityType === 'email_campaign' && id) {
          const uuid = parseUuid(id);
          entityHref = uuid ? { pathname: `/admin/kampanie/${uuid}` } : null;
        }
        return {
          id: asString(row['id']),
          action: asString(row['action']),
          entityType,
          entityId: id,
          entityLabel,
          entityHref,
          statusBefore: statusOf(row['before_data']),
          statusAfter: statusOf(row['after_data']),
          reason:
            entityType === 'company' ||
            entityType === 'email_suppression' ||
            entityType === 'screening_question_review' ||
            asString(row['action']) === 'moderation.restored'
              ? asNullableString(asRecord(row['after_data'])['reason'])
              : null,
          actorId,
          actorName: actorId ? (actorName.get(actorId) ?? null) : null,
          createdAt: asNullableString(row['created_at']),
        };
      }),
      (row) => row.createdAt,
    );
  } catch (error) {
    captureError(error, { area: 'admin.listAuditLogs' });
    return { status: 'error' };
  }
}

/* ---------------------------------------------------------------------------
 * Szczegół firmy (#310) — dane rejestrowe, członkowie, oferty
 * ------------------------------------------------------------------------- */

/** Maks. liczba ofert w szczególe firmy (reszta: licznik `jobsTotal`). */
export const ADMIN_COMPANY_JOBS_LIMIT = 20;

export interface AdminCompanyMember {
  id: string;
  /** Imię i nazwisko (może być puste). */
  name: string;
  email: string | null;
  /** `company_member_role`: owner/admin/recruiter/member. */
  role: string;
  isActive: boolean;
  /** Członkostwo od (joined_at albo created_at). */
  since: string | null;
}

export interface AdminCompanyJob {
  id: string;
  title: string;
  /** `job_status`: draft/active/paused/closed/expired. */
  status: string;
  /** Slug publicznej oferty — link tylko dla aktywnych ofert. */
  slug: string | null;
  createdAt: string | null;
}

export interface AdminCompanyDetail extends AdminCompanyRow {
  website: string | null;
  phone: string | null;
  address: string | null;
  postalCode: string | null;
  region: string | null;
  country: string | null;
  industry: string | null;
  description: string | null;
  verifiedAt: string | null;
  /** Uzasadnienie ostatniego odrzucenia/zawieszenia (0084) — tylko dla rejected/suspended. */
  statusReason: string | null;
  members: AdminCompanyMember[];
  jobs: AdminCompanyJob[];
  /** Łączna liczba ofert (bez usuniętych); `jobs` to najnowsze `ADMIN_COMPANY_JOBS_LIMIT`. */
  jobsTotal: number;
  /** Weryfikacja numeru VAT w VIES (#92) — informacja dla admina, nie decyzja. */
  vies: AdminViesState;
}

export type AdminCompanyDetailResult =
  | { status: 'ok'; company: AdminCompanyDetail }
  | { status: 'not_found' }
  | { status: 'error' };

function demoCompanyDetail(id: string): AdminCompanyDetailResult {
  const row = DEMO_COMPANIES.find((c) => c.id === id);
  if (!row) return { status: 'not_found' };
  const jobs = demoJobs.slice(0, 2).map((job, index) => ({
    id: `${row.id}-job-${index + 1}`,
    title: job.title,
    status: index === 0 ? 'active' : 'draft',
    slug: index === 0 ? job.slug : null,
    createdAt: row.createdAt,
  }));
  return {
    status: 'ok',
    company: {
      ...row,
      website: null,
      phone: null,
      address: null,
      postalCode: null,
      region: null,
      country: 'BE',
      industry: null,
      description: null,
      verifiedAt: row.status === 'verified' ? row.createdAt : null,
      statusReason: null,
      members: [
        {
          id: `${row.id}-m1`,
          name: 'Jan Peeters',
          email: 'jan.peeters@example.com',
          role: 'owner',
          isActive: true,
          since: row.createdAt,
        },
      ],
      jobs,
      jobsTotal: jobs.length,
      vies: buildViesState({
        companyName: row.name,
        vatSource: companyVatSource(row.vatNumber, row.registrationNumber),
        stored: null,
      }),
    },
  };
}

/**
 * Ostatni rozstrzygający wynik VIES (0088). Błąd odczytu nie psuje szczegółu firmy —
 * sekcja w `attempt` (SAVEPOINT), a stan `load_error` pozwala i tak sprawdzić numer ręcznie.
 */
async function readStoredViesCheck(
  tx: TransactionQuery,
  companyId: string,
): Promise<{ stored: StoredViesCheck | null; failed: boolean }> {
  const read = await attempt(tx, () =>
    queryOne(tx, 'admin.company-vies-check',
      `SELECT vat_number, result, vies_name, checked_at
         FROM public.company_vies_checks
        WHERE company_id = $1`, [companyId]),
  );
  if (!read.ok) {
    captureError(read.error, { area: 'admin.readStoredViesCheck' });
    return { stored: null, failed: true };
  }
  if (!read.value) return { stored: null, failed: false };
  const row = asRecord(read.value);
  const result = asString(row['result']);
  const checkedAt = asNullableString(row['checked_at']);
  if ((result !== 'valid' && result !== 'invalid') || !checkedAt) {
    return { stored: null, failed: true };
  }
  return {
    stored: {
      vatNumber: asString(row['vat_number']),
      result,
      viesName: asNullableString(row['vies_name']),
      checkedAt,
    },
    failed: false,
  };
}

/**
 * Szczegół firmy dla decyzji admina (#310): dane rejestrowe, uzasadnienie ostatniej decyzji,
 * członkowie (z rolą i aktywnością) oraz najnowsze oferty. Nieistniejąca/usunięta firma albo
 * zły identyfikator → `not_found`; błąd któregokolwiek odczytu → `error` (bez częściowych danych).
 */
export async function getCompanyDetail(id: string): Promise<AdminCompanyDetailResult> {
  if (!isPortalDataConfigured()) return demoCompanyDetail(id);
  await requireAdmin();

  const uuid = parseUuid(id);
  if (!uuid) return { status: 'not_found' };

  try {
    const loaded = await withServiceRole(async (tx) => {
      const company = await queryOne(tx, 'admin.company-detail',
        `SELECT id, name, status, status_reason, created_at, verified_at, vat_number,
                registration_number, email, phone, website, address, postal_code, city, region,
                country, industry, description
           FROM public.companies
          WHERE id = $1 AND deleted_at IS NULL`, [uuid]);
      if (!company) return null;
      // Członek + jego profil (odpowiednik osadzenia `profiles!company_members_profile_id_fkey`).
      const members = await queryRows(tx, 'admin.company-members',
        `SELECT m.id, m.role, m.is_active, m.joined_at, m.created_at,
                (SELECT to_json(p) FROM (
                   SELECT pr.first_name, pr.last_name, pr.email
                     FROM public.profiles pr WHERE pr.id = m.profile_id) p) AS profiles
           FROM public.company_members m
          WHERE m.company_id = $1
          ORDER BY m.created_at ASC, m.id ASC`, [uuid]);
      const jobs = await queryRows(tx, 'admin.company-jobs',
        `SELECT id, title, status, slug, created_at
           FROM public.jobs
          WHERE company_id = $1 AND deleted_at IS NULL
          ORDER BY created_at DESC, id DESC
          LIMIT $2`, [uuid, ADMIN_COMPANY_JOBS_LIMIT]);
      const jobsTotal = await queryCount(tx, 'admin.company-jobs-count',
        'SELECT 1 FROM public.jobs WHERE company_id = $1 AND deleted_at IS NULL', [uuid]);
      const c = asRecord(company);
      const vatSource = companyVatSource(
        asNullableString(c['vat_number']),
        asNullableString(c['registration_number']),
      );
      const viesRead = vatSource
        ? await readStoredViesCheck(tx, uuid)
        : { stored: null, failed: false };
      return { c, members: asRows(members), jobs: asRows(jobs), jobsTotal, vatSource, viesRead };
    });
    if (!loaded) return { status: 'not_found' };

    const { c, vatSource, viesRead } = loaded;
    const status = asString(c['status'], 'unverified');
    const jobs = loaded.jobs.map((row) => ({
      id: asString(row['id']),
      title: asString(row['title']),
      status: asString(row['status'], 'draft'),
      slug: asNullableString(row['slug']),
      createdAt: asNullableString(row['created_at']),
    }));

    return {
      status: 'ok',
      company: {
        id: asString(c['id']),
        name: asString(c['name']),
        status,
        createdAt: asNullableString(c['created_at']),
        vatNumber: asNullableString(c['vat_number']),
        registrationNumber: asNullableString(c['registration_number']),
        email: asNullableString(c['email']),
        city: asNullableString(c['city']),
        website: asNullableString(c['website']),
        phone: asNullableString(c['phone']),
        address: asNullableString(c['address']),
        postalCode: asNullableString(c['postal_code']),
        region: asNullableString(c['region']),
        country: asNullableString(c['country']),
        industry: asNullableString(c['industry']),
        description: asNullableString(c['description']),
        verifiedAt: asNullableString(c['verified_at']),
        statusReason:
          status === 'rejected' || status === 'suspended'
            ? asNullableString(c['status_reason'])
            : null,
        members: loaded.members.map((row) => {
          const profile = asRecord(row['profiles']);
          return {
            id: asString(row['id']),
            name: fullName(profile),
            email: asNullableString(profile['email']),
            role: asString(row['role'], 'member'),
            isActive: row['is_active'] === true,
            since: asNullableString(row['joined_at']) ?? asNullableString(row['created_at']),
          };
        }),
        jobs,
        jobsTotal: loaded.jobsTotal,
        vies: buildViesState({
          companyName: asString(c['name']),
          vatSource,
          stored: viesRead.stored,
          storedLoadFailed: viesRead.failed,
        }),
      },
    };
  } catch (error) {
    captureError(error, { area: 'admin.getCompanyDetail' });
    return { status: 'error' };
  }
}

/* ---------------------------------------------------------------------------
 * Blokady adresów e-mail (#44) — podgląd i zdjęcie blokady
 * ------------------------------------------------------------------------- */

export interface AdminEmailSuppressionRow {
  id: string;
  email: string;
  /** `hard_bounce` / `complaint` — UI mapuje na etykietę i18n. */
  reason: string;
  createdAt: string | null;
  liftedAt: string | null;
  liftReason: string | null;
  liftedByName: string | null;
}

export interface AdminEmailSuppressionsQuery extends AdminListQuery {
  status?: string | null;
}

const DEMO_EMAIL_SUPPRESSIONS: AdminEmailSuppressionRow[] = [
  {
    id: 'demo-s1',
    email: 'nieaktywny.adres@example.com',
    reason: 'hard_bounce',
    createdAt: '2025-02-10T08:15:00.000Z',
    liftedAt: null,
    liftReason: null,
    liftedByName: null,
  },
  {
    id: 'demo-s2',
    email: 'skarga@example.com',
    reason: 'complaint',
    createdAt: '2025-02-08T17:40:00.000Z',
    liftedAt: null,
    liftReason: null,
    liftedByName: null,
  },
  {
    id: 'demo-s3',
    email: 'poprawiony.adres@example.com',
    reason: 'hard_bounce',
    createdAt: '2025-01-20T11:05:00.000Z',
    liftedAt: '2025-01-22T09:30:00.000Z',
    liftReason: 'Użytkownik poprawił skrzynkę i potwierdził adres.',
    liftedByName: 'Zespół Pracuj.be',
  },
];

/**
 * Lista blokad adresów (#44): filtr aktywne/zdjęte/wszystkie (domyślnie aktywne),
 * wyszukiwanie po adresie, stronicowanie kursorem. Bez env → DEMO.
 */
export async function listEmailSuppressions(
  query: AdminEmailSuppressionsQuery = {},
): Promise<AdminListResult<AdminEmailSuppressionRow>> {
  const filter = parseEmailSuppressionFilter(query.status);
  const q = normalizeAdminSearch(query.q);
  if (!isPortalDataConfigured()) {
    return demoList(
      DEMO_EMAIL_SUPPRESSIONS.filter(
        (row) =>
          (filter === 'all' || (filter === 'active') === (row.liftedAt === null)) &&
          matchesSearch([row.email], q),
      ),
    );
  }
  await requireAdmin();

  try {
    const params = new SqlParams();
    const where = whereOf([
      filter === 'active' && 'lifted_at IS NULL',
      filter === 'lifted' && 'lifted_at IS NOT NULL',
      q && searchCondition(params, ['email'], q),
      cursorCondition(params, query.cursor),
    ]);
    const limit = params.add(ADMIN_PAGE_SIZE + 1);
    const { rows, profiles } = await withServiceRole(async (tx) => {
      const page = asRows(
        await queryRows(tx, 'admin.email-suppressions',
          `SELECT id, email, reason, created_at, lifted_at, lifted_by, lift_reason
             FROM public.email_suppressions
             ${where}
            ORDER BY created_at DESC, id DESC
            LIMIT ${limit}`, params.values),
      );
      const adminIds = uniqueIds(page.map((r) => asString(r['lifted_by'])));
      return { rows: page, profiles: asRows(await readProfileNames(tx, 'admin.email-suppression-admins', adminIds)) };
    });

    const nameById = new Map<string, string>();
    for (const profile of profiles) {
      nameById.set(asString(profile['id']), fullName(profile));
    }

    return toPage(
      rows.map((row) => {
        const liftedBy = asString(row['lifted_by']);
        const name = liftedBy ? (nameById.get(liftedBy) ?? '') : '';
        return {
          id: asString(row['id']),
          email: asString(row['email']),
          reason: asString(row['reason']),
          createdAt: asNullableString(row['created_at']),
          liftedAt: asNullableString(row['lifted_at']),
          liftReason: asNullableString(row['lift_reason']),
          liftedByName: name.length > 0 ? name : null,
        };
      }),
      (row) => row.createdAt,
    );
  } catch (error) {
    captureError(error, { area: 'admin.listEmailSuppressions' });
    return { status: 'error' };
  }
}

/* ---------------------------------------------------------------------------
 * Wiadomości z formularza kontaktu (#61, 0115)
 * ------------------------------------------------------------------------- */

export interface AdminContactMessageRow {
  id: string;
  reference: string;
  /** Temat ze słownika (`CONTACT_TOPICS`) — UI mapuje na etykietę i18n. */
  topic: string;
  message: string;
  senderName: string | null;
  senderEmail: string;
  /** Język formularza (w nim nadawca dostał potwierdzenie). */
  locale: string;
  status: 'new' | 'handled';
  createdAt: string | null;
  handledAt: string | null;
  handledByName: string | null;
}

export interface AdminContactMessagesQuery extends AdminListQuery {
  status?: string | null;
}

const DEMO_CONTACT_MESSAGES: AdminContactMessageRow[] = [
  {
    id: 'demo-cm1',
    reference: 'KON-0DE0-0001',
    topic: 'candidate_account',
    message: 'Przykładowa wiadomość: nie widzę zapisanych umiejętności po powrocie do kreatora profilu.',
    senderName: 'Przykładowy nadawca',
    senderEmail: 'nadawca@example.com',
    locale: 'pl',
    status: 'new',
    createdAt: '2025-02-11T09:20:00.000Z',
    handledAt: null,
    handledByName: null,
  },
];

/**
 * Lista wiadomości z formularza kontaktu (#61): filtr nowe/obsłużone/wszystkie (domyślnie
 * nowe), wyszukiwanie po numerze, adresie i imieniu, stronicowanie kursorem. Odczyt
 * service-rolem po potwierdzeniu roli admina. Bez env → DEMO.
 */
export async function listContactMessages(
  query: AdminContactMessagesQuery = {},
): Promise<AdminListResult<AdminContactMessageRow>> {
  const filter = parseContactMessageFilter(query.status);
  const q = normalizeAdminSearch(query.q);
  if (!isPortalDataConfigured()) {
    return demoList(
      DEMO_CONTACT_MESSAGES.filter(
        (row) =>
          (filter === 'all' || row.status === filter) &&
          matchesSearch([row.reference, row.senderEmail, row.senderName ?? ''], q),
      ),
    );
  }
  await requireAdmin();

  try {
    const params = new SqlParams();
    const where = whereOf([
      filter === 'new' && "status = 'new'",
      filter === 'handled' && "status = 'handled'",
      q && searchCondition(params, ['reference', 'sender_email', 'sender_name'], q),
      cursorCondition(params, query.cursor),
    ]);
    const limit = params.add(ADMIN_PAGE_SIZE + 1);
    const { rows, profiles } = await withServiceRole(async (tx) => {
      const page = asRows(
        await queryRows(tx, 'admin.contact-messages',
          `SELECT id, reference, topic, message, sender_name, sender_email, locale, status,
                  created_at, handled_at, handled_by
             FROM public.contact_messages
             ${where}
            ORDER BY created_at DESC, id DESC
            LIMIT ${limit}`, params.values),
      );
      const adminIds = uniqueIds(page.map((r) => asString(r['handled_by'])));
      return { rows: page, profiles: asRows(await readProfileNames(tx, 'admin.contact-message-admins', adminIds)) };
    });

    const nameById = new Map<string, string>();
    for (const profile of profiles) {
      nameById.set(asString(profile['id']), fullName(profile));
    }

    return toPage(
      rows.map((row) => {
        const handledBy = asString(row['handled_by']);
        const name = handledBy ? (nameById.get(handledBy) ?? '') : '';
        return {
          id: asString(row['id']),
          reference: asString(row['reference']),
          topic: asString(row['topic']),
          message: asString(row['message']),
          senderName: asNullableString(row['sender_name']),
          senderEmail: asString(row['sender_email']),
          locale: asString(row['locale']),
          status: asString(row['status']) === 'handled' ? ('handled' as const) : ('new' as const),
          createdAt: asNullableString(row['created_at']),
          handledAt: asNullableString(row['handled_at']),
          handledByName: name.length > 0 ? name : null,
        };
      }),
      (row) => row.createdAt,
    );
  } catch (error) {
    captureError(error, { area: 'admin.listContactMessages' });
    return { status: 'error' };
  }
}

/* ---------------------------------------------------------------------------
 * Przegląd pytań screeningowych (#497, 0103)
 * ------------------------------------------------------------------------- */

export interface AdminScreeningReviewRow {
  id: string;
  jobId: string;
  jobTitle: string;
  jobStatus: string;
  companyId: string;
  companyName: string;
  questionType: ScreeningQuestionType;
  prompt: LocalizedText;
  options: { label: LocalizedText }[];
  categories: ScreeningRiskCategory[];
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string | null;
  requestedByName: string | null;
  decidedAt: string | null;
  decidedByName: string | null;
  reason: string | null;
  /** Treść nadal jest w ofercie (inaczej decyzja nieaktualna — RPC zwróci STALE_STATE). */
  current: boolean;
}

export interface AdminScreeningReviewsQuery {
  status?: string | null;
  cursor?: string | null;
}

const DEMO_SCREENING_REVIEWS: AdminScreeningReviewRow[] = [
  {
    id: 'demo-sr1',
    jobId: 'demo-job-1',
    jobTitle: 'Magazynier / Magazynierka',
    jobStatus: 'draft',
    companyId: 'demo-c1',
    companyName: 'Logistiek Gent BV',
    questionType: 'date',
    prompt: { pl: 'Podaj datę urodzenia', nl: 'Wat is je geboortedatum?' },
    options: [],
    categories: ['age'],
    status: 'pending',
    createdAt: '2025-01-21T08:15:00.000Z',
    requestedByName: 'Anna Nowak',
    decidedAt: null,
    decidedByName: null,
    reason: null,
    current: true,
  },
  {
    id: 'demo-sr2',
    jobId: 'demo-job-2',
    jobTitle: 'Kierowca C+E',
    jobStatus: 'draft',
    companyId: 'demo-c2',
    companyName: 'Transport Liège SA',
    questionType: 'yes_no',
    prompt: { pl: 'Czy masz zaświadczenie o niekaralności?' },
    options: [],
    categories: ['criminal'],
    status: 'rejected',
    createdAt: '2025-01-19T10:40:00.000Z',
    requestedByName: 'Marc Dubois',
    decidedAt: '2025-01-20T09:00:00.000Z',
    decidedByName: 'Zespół Pracuj.be',
    reason: 'Brak wskazanej podstawy dla tego stanowiska.',
    current: true,
  },
];

function reviewStatusOf(value: unknown): AdminScreeningReviewRow['status'] {
  return value === 'approved' || value === 'rejected' ? value : 'pending';
}

/**
 * Kolejka przeglądu pytań (#497): filtr oczekujące (domyślnie) / rozstrzygnięte / wszystkie,
 * stronicowanie kursorem (`created_at`, `id`). „Oczekujące” pokazuje tylko treść nadal obecną
 * w ofercie — autozapis kroku z inną treścią zostawia stary wiersz jako historię. Bez env → DEMO.
 */
export async function listScreeningReviews(
  query: AdminScreeningReviewsQuery = {},
): Promise<AdminListResult<AdminScreeningReviewRow>> {
  const filter = parseScreeningReviewFilter(query.status);
  if (!isPortalDataConfigured()) {
    return demoList(
      DEMO_SCREENING_REVIEWS.filter(
        (row) =>
          filter === 'all' || (filter === 'pending') === (row.status === 'pending'),
      ),
    );
  }
  await requireAdmin();

  try {
    const params = new SqlParams();
    const where = whereOf([
      filter === 'pending' && "status = 'pending'",
      filter === 'decided' && "status IN ('approved', 'rejected')",
      cursorCondition(params, query.cursor),
    ]);
    const limit = params.add(ADMIN_PAGE_SIZE + 1);
    const { raw, jobs, questions, profiles } = await withServiceRole(async (tx) => {
      const reviews = asRows(
        await queryRows(tx, 'admin.screening-reviews',
          `SELECT id, job_id, content_fingerprint, risk_categories, question_type, prompt, options,
                  status, created_at, requested_by, decided_by, decided_at, decision_reason
             FROM public.screening_question_reviews
             ${where}
            ORDER BY created_at DESC, id DESC
            LIMIT ${limit}`, params.values),
      );
      const pageRows = reviews.slice(0, ADMIN_PAGE_SIZE);
      const jobIds = uniqueIds(pageRows.map((r) => asString(r['job_id'])));
      const profileIds = uniqueIds(
        pageRows.flatMap((r) => [asString(r['requested_by']), asString(r['decided_by'])]),
      );
      return {
        raw: reviews,
        jobs: jobIds.length > 0
          ? asRows(await queryRows(tx, 'admin.screening-review-jobs',
              `SELECT j.id, j.title, j.status, j.company_id, j.deleted_at,
                      (SELECT to_json(c) FROM (SELECT name FROM public.companies c WHERE c.id = j.company_id) c) AS companies
                 FROM public.jobs j WHERE j.id = ANY($1::uuid[])`, [jobIds]))
          : [],
        questions: jobIds.length > 0
          ? asRows(await queryRows(tx, 'admin.screening-review-questions',
              `SELECT job_id, content_fingerprint FROM public.job_screening_questions
                WHERE job_id = ANY($1::uuid[])`, [jobIds]))
          : [],
        profiles: asRows(await readProfileNames(tx, 'admin.screening-review-profiles', profileIds)),
      };
    });
    const page = raw.slice(0, ADMIN_PAGE_SIZE);
    const lastRaw = page[page.length - 1];
    const lastCreatedAt = lastRaw ? asNullableString(lastRaw['created_at']) : null;
    const nextCursor =
      raw.length > ADMIN_PAGE_SIZE && lastRaw && lastCreatedAt
        ? encodeAdminCursor({ createdAt: lastCreatedAt, id: asString(lastRaw['id']) })
        : null;

    const jobById = new Map(jobs.map((job) => [asString(job['id']), job]));
    const present = new Set(
      questions.map(
        (q) => `${asString(q['job_id'])}:${asString(q['content_fingerprint'])}`,
      ),
    );
    const nameById = new Map(
      profiles.map((profile) => [asString(profile['id']), fullName(profile)]),
    );
    const nameOf = (id: string): string | null => {
      const name = id ? nameById.get(id) : undefined;
      return name && name.length > 0 ? name : null;
    };

    const rows = page
      .map((row): AdminScreeningReviewRow => {
        const jobId = asString(row['job_id']);
        const job = jobById.get(jobId) ?? {};
        const company = asRecord(job['companies']);
        const type = row['question_type'];
        return {
          id: asString(row['id']),
          jobId,
          jobTitle: asString(job['title']),
          jobStatus: asString(job['status']),
          companyId: asString(job['company_id']),
          companyName: asString(company['name']),
          questionType: isScreeningQuestionType(type) ? type : 'short_text',
          prompt: toLocalizedText(row['prompt']),
          options: (Array.isArray(row['options']) ? row['options'] : []).map((option) => ({
            label: toLocalizedText(asRecord(option)['label']),
          })),
          categories: (Array.isArray(row['risk_categories']) ? row['risk_categories'] : []).filter(
            isScreeningRiskCategory,
          ),
          status: reviewStatusOf(row['status']),
          createdAt: asNullableString(row['created_at']),
          requestedByName: nameOf(asString(row['requested_by'])),
          decidedAt: asNullableString(row['decided_at']),
          decidedByName: nameOf(asString(row['decided_by'])),
          reason: asNullableString(row['decision_reason']),
          current:
            job['deleted_at'] == null &&
            present.has(`${jobId}:${asString(row['content_fingerprint'])}`),
        };
      })
      .filter((row) => filter !== 'pending' || row.current);

    return { status: 'ok', rows, nextCursor };
  } catch (error) {
    captureError(error, { area: 'admin.listScreeningReviews' });
    return { status: 'error' };
  }
}

/* ---------------------------------------------------------------------------
 * Rejestr incydentów i naruszeń danych osobowych (#490)
 * ------------------------------------------------------------------------- */

export interface AdminBreachRow {
  id: string;
  reference: string;
  kind: string;
  title: string;
  status: string;
  detectedAt: string | null;
  riskLevel: string;
  authorityDecision: string;
  authorityNotifiedAt: string | null;
  subjectsDecision: string;
  createdAt: string | null;
}

export interface AdminBreachEvent {
  id: string;
  version: number;
  /** created/updated/closed/reopened/subjects_notified/exported. */
  eventType: string;
  /** Zmienione pola (kolumny bazy) — przed/po. */
  changes: Record<string, { from: unknown; to: unknown }>;
  note: string;
  actorName: string | null;
  createdAt: string | null;
}

export interface AdminBreachNotice {
  id: string;
  recipientCount: number;
  queuedCount: number;
  locales: string[];
  createdAt: string | null;
}

export interface AdminBreachDetail extends AdminBreachRow {
  description: string;
  occurredAt: string | null;
  dataCategories: string[];
  affectedCount: number | null;
  affectedCountEstimated: boolean;
  riskAssessment: string;
  authorityDecisionReason: string;
  authorityReference: string;
  authorityDelayReason: string;
  subjectsDecisionReason: string;
  subjectsNotifiedAt: string | null;
  actionsTaken: string;
  closedAt: string | null;
  closureSummary: string;
  version: number;
  events: AdminBreachEvent[];
  notices: AdminBreachNotice[];
}

export type AdminBreachDetailResult =
  | { status: 'ok'; incident: AdminBreachDetail }
  | { status: 'not_found' }
  | { status: 'error' };

export interface AdminBreachesQuery extends AdminListQuery {
  status?: string | null;
}

const DEMO_BREACH_DETAIL: AdminBreachDetail = {
  id: 'demo-b1',
  reference: 'NAR-2025-DEMO000001',
  kind: 'personal_data_breach',
  title: 'Przykładowy wpis: e-mail do niewłaściwego odbiorcy',
  status: 'open',
  detectedAt: '2025-02-10T08:15:00.000Z',
  riskLevel: 'not_assessed',
  authorityDecision: 'pending',
  authorityNotifiedAt: null,
  subjectsDecision: 'pending',
  createdAt: '2025-02-10T08:30:00.000Z',
  description: 'Wpis demonstracyjny — w trybie bez bazy zapis nie jest możliwy.',
  occurredAt: null,
  dataCategories: ['contact'],
  affectedCount: 1,
  affectedCountEstimated: false,
  riskAssessment: '',
  authorityDecisionReason: '',
  authorityReference: '',
  authorityDelayReason: '',
  subjectsDecisionReason: '',
  subjectsNotifiedAt: null,
  actionsTaken: '',
  closedAt: null,
  closureSummary: '',
  version: 1,
  events: [
    {
      id: 'demo-e1',
      version: 1,
      eventType: 'created',
      changes: {},
      note: '',
      actorName: null,
      createdAt: '2025-02-10T08:30:00.000Z',
    },
  ],
  notices: [],
};

function breachRowOf(row: Record<string, unknown>): AdminBreachRow {
  return {
    id: asString(row['id']),
    reference: asString(row['reference']),
    kind: asString(row['kind']),
    title: asString(row['title']),
    status: asString(row['status']),
    detectedAt: asNullableString(row['detected_at']),
    riskLevel: asString(row['risk_level']),
    authorityDecision: asString(row['authority_decision']),
    authorityNotifiedAt: asNullableString(row['authority_notified_at']),
    subjectsDecision: asString(row['subjects_decision']),
    createdAt: asNullableString(row['created_at']),
  };
}

const BREACH_LIST_COLUMNS =
  'id, reference, kind, title, status, detected_at, risk_level, authority_decision, authority_notified_at, subjects_decision, created_at';

/** Lista rejestru (#490): filtr otwarte/zamknięte/wszystkie, wyszukiwanie po numerze i tytule. */
export async function listBreachIncidents(
  query: AdminBreachesQuery = {},
): Promise<AdminListResult<AdminBreachRow>> {
  const filter = parseBreachFilter(query.status);
  const q = normalizeAdminSearch(query.q);
  if (!isPortalDataConfigured()) {
    return demoList(
      [DEMO_BREACH_DETAIL].filter(
        (row) =>
          (filter === 'all' || row.status === filter) && matchesSearch([row.reference, row.title], q),
      ),
    );
  }
  await requireAdmin();

  try {
    const params = new SqlParams();
    const where = whereOf([
      filter !== 'all' && `status::text = ${params.add(filter)}`,
      q && searchCondition(params, ['reference', 'title'], q),
      cursorCondition(params, query.cursor),
    ]);
    const limit = params.add(ADMIN_PAGE_SIZE + 1);
    const data = await withServiceRole((tx) =>
      queryRows(tx, 'admin.breaches',
        `SELECT ${BREACH_LIST_COLUMNS}
           FROM public.breach_incidents
           ${where}
          ORDER BY created_at DESC, id DESC
          LIMIT ${limit}`, params.values),
    );
    return toPage(asRows(data).map(breachRowOf), (row) => row.createdAt);
  } catch (error) {
    captureError(error, { area: 'admin.listBreachIncidents' });
    return { status: 'error' };
  }
}

function asInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

/** Szczegół wpisu z historią i zawiadomieniami (bez adresów odbiorców). */
export async function getBreachIncident(id: string): Promise<AdminBreachDetailResult> {
  if (!isPortalDataConfigured()) {
    return id === DEMO_BREACH_DETAIL.id
      ? { status: 'ok', incident: DEMO_BREACH_DETAIL }
      : { status: 'not_found' };
  }
  await requireAdmin();
  const uuid = parseUuid(id);
  if (!uuid) return { status: 'not_found' };

  try {
    const loaded = await withServiceRole(async (tx) => {
      const incidentRow = await queryOne(tx, 'admin.breach',
        'SELECT * FROM public.breach_incidents WHERE id = $1', [uuid]);
      if (!incidentRow) return null;
      const events = await queryRows(tx, 'admin.breach-events',
        `SELECT id, version, event_type, actor_id, changes, note, created_at
           FROM public.breach_incident_events
          WHERE incident_id = $1
          ORDER BY created_at ASC, id ASC`, [uuid]);
      const notices = await queryRows(tx, 'admin.breach-notices',
        `SELECT id, recipient_count, queued_count, content, created_at
           FROM public.breach_notices
          WHERE incident_id = $1
          ORDER BY created_at DESC`, [uuid]);
      const actorIds = uniqueIds(asRows(events).map((e) => asString(e['actor_id'])));
      const profiles = actorIds.length > 0
        ? await queryRows(tx, 'admin.breach-actors',
          'SELECT id, first_name, last_name FROM public.profiles WHERE id = ANY($1::uuid[])', [actorIds])
        : [];
      return { incidentRow, events, notices, profiles };
    });
    if (!loaded) return { status: 'not_found' };
    const row = asRecord(loaded.incidentRow);
    const eventRows = asRows(loaded.events);
    const nameById = new Map<string, string>();
    for (const profile of asRows(loaded.profiles)) nameById.set(asString(profile['id']), fullName(profile));

    const incident: AdminBreachDetail = {
      ...breachRowOf(row),
      description: asString(row['description']),
      occurredAt: asNullableString(row['occurred_at']),
      dataCategories: Array.isArray(row['data_categories'])
        ? row['data_categories'].filter((c): c is string => typeof c === 'string')
        : [],
      affectedCount: asInteger(row['affected_count']),
      affectedCountEstimated: row['affected_count_estimated'] !== false,
      riskAssessment: asString(row['risk_assessment']),
      authorityDecisionReason: asString(row['authority_decision_reason']),
      authorityReference: asString(row['authority_reference']),
      authorityDelayReason: asString(row['authority_delay_reason']),
      subjectsDecisionReason: asString(row['subjects_decision_reason']),
      subjectsNotifiedAt: asNullableString(row['subjects_notified_at']),
      actionsTaken: asString(row['actions_taken']),
      closedAt: asNullableString(row['closed_at']),
      closureSummary: asString(row['closure_summary']),
      version: asInteger(row['version']) ?? 1,
      events: eventRows.map((e) => {
        const actorId = asString(e['actor_id']);
        const name = actorId ? (nameById.get(actorId) ?? '') : '';
        const changes = asRecord(e['changes']);
        return {
          id: asString(e['id']),
          version: asInteger(e['version']) ?? 0,
          eventType: asString(e['event_type']),
          changes: Object.fromEntries(
            Object.entries(changes).map(([key, value]) => {
              const pair = asRecord(value);
              return [key, { from: pair['from'] ?? null, to: pair['to'] ?? null }];
            }),
          ),
          note: asString(e['note']),
          actorName: name.length > 0 ? name : null,
          createdAt: asNullableString(e['created_at']),
        };
      }),
      notices: asRows(loaded.notices).map((n) => ({
        id: asString(n['id']),
        recipientCount: asInteger(n['recipient_count']) ?? 0,
        queuedCount: asInteger(n['queued_count']) ?? 0,
        locales: Object.keys(asRecord(n['content'])).sort(),
        createdAt: asNullableString(n['created_at']),
      })),
    };
    return { status: 'ok', incident };
  } catch (error) {
    captureError(error, { area: 'admin.getBreachIncident' });
    return { status: 'error' };
  }
}

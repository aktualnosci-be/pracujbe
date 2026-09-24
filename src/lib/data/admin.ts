/**
 * Warstwa danych panelu administratora — Pracuj.be (Etap 7g).
 *
 * ⚠️ ODCZYTY przez `createAdminClient()` (service-role, OMIJA RLS). Każda funkcja publiczna
 * SAMA potwierdza rolę `admin` sesji (`requireAdmin`) PRZED utworzeniem klienta service-role —
 * guard w `admin/layout.tsx` nie wystarcza (layout nie musi się renderować razem ze stroną).
 * Brak sesji, inna rola albo błąd odczytu roli → `notFound()` (fail closed, nie ujawniamy
 * panelu). Klient service-role importowany LENIWIE, żeby moduł nie ciągnął
 * `server-only`/klienta do bundla trybu DEMO oraz żeby build bez env przechodził.
 *
 * Bez konfiguracji Supabase (`isSupabaseConfigured() === false`) zwracamy dane DEMO —
 * dzięki temu panel renderuje się w podglądzie/buildzie bez backendu.
 */

import { notFound } from 'next/navigation';
import { cache } from 'react';

import {
  ADMIN_PAGE_SIZE,
  cursorOrFilter,
  decodeAdminCursor,
  encodeAdminCursor,
  matchesSearch,
  normalizeAdminSearch,
  parseAuditAction,
  parseAuditEntity,
  parseReportFilter,
  parseReportKindFilter,
  parseUserRoleFilter,
  parseUuid,
  parseYmd,
  reportStatusesFor,
  searchOrFilter,
} from '@/lib/admin/list-params';
import { appDayStartUtc } from '@/lib/datetime';
import { demoJobs } from '@/lib/data/demo';
import { isSupabaseConfigured } from '@/lib/env';
import { captureError } from '@/lib/sentry';
import { createServerClient } from '@/lib/supabase/server';
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

/** Zdarzenie historii sprawy DSA (`report_events`, 0094; decyzja/przywrócenie/flaga — 0095). */
export interface AdminReportEvent {
  type: 'submitted' | 'status_changed' | 'decision' | 'restored' | 'flagged';
  toStatus: string | null;
  at: string;
}

const REPORT_EVENT_TYPES: readonly AdminReportEvent['type'][] = [
  'submitted',
  'status_changed',
  'decision',
  'restored',
  'flagged',
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
 * Pomocnicze parsowanie (klient Supabase jest nietypowany → dane `any`)
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
 * Potwierdza rolę `admin` bieżącej sesji (odczyt własnego profilu pod RLS). Wynik
 * zapamiętany na czas jednego żądania (`cache`), więc kilka odczytów strony = jedno sprawdzenie.
 */
const isAdminSession = cache(async (): Promise<boolean> => {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return false;
    const { data, error } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();
    if (error) throw error;
    return asString(asRecord(data)['role']) === 'admin';
  } catch (error) {
    captureError(error, { area: 'admin.requireAdmin' });
    return false;
  }
});

/** Bez roli admina → `notFound()` (rzuca). Wołane przed każdym odczytem service-role. */
async function requireAdmin(): Promise<void> {
  if (!(await isAdminSession())) notFound();
}

/* ---------------------------------------------------------------------------
 * Publiczne API
 * ------------------------------------------------------------------------- */

/** Kafelki statystyk dashboardu admina. Bez env → dane DEMO. Błąd dowolnego licznika → `error`. */
export async function getAdminStats(): Promise<AdminStatsResult> {
  if (!isSupabaseConfigured()) return { status: 'ok', stats: DEMO_STATS };
  await requireAdmin();

  try {
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const supabase = createAdminClient();

    const results = await Promise.all([
      supabase
        .from('companies')
        .select('id', { count: 'exact', head: true })
        .is('deleted_at', null),
      supabase
        .from('companies')
        .select('id', { count: 'exact', head: true })
        .in('status', [...AWAITING_COMPANY_STATUSES])
        .is('deleted_at', null),
      supabase.from('profiles').select('id', { count: 'exact', head: true }).is('deleted_at', null),
      supabase.from('reports').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    ]);

    const failed = results.find((r) => r.error || typeof r.count !== 'number');
    if (failed) throw failed.error ?? new Error('ADMIN_STATS_COUNT_MISSING');

    const [companies, pending, users, reports] = results;
    return {
      status: 'ok',
      stats: {
        companies: companies.count as number,
        pendingCompanies: pending.count as number,
        users: users.count as number,
        openReports: reports.count as number,
      },
    };
  } catch (error) {
    captureError(error, { area: 'admin.getAdminStats' });
    return { status: 'error' };
  }
}

/** Filtr kursora z tokenu URL (zły token = pierwsza strona). */
function cursorFilterOf(token: string | null | undefined): string | null {
  const cursor = decodeAdminCursor(token);
  return cursor ? cursorOrFilter(cursor) : null;
}

/**
 * Łączy warunki `or` (wyszukiwanie + kursor) w jeden parametr PostgREST: dwa osobne `.or()`
 * dałyby dwa parametry `or` w URL, więc zagnieżdżamy je w `and(or(..),or(..))`.
 */
function combineOrFilters(...filters: Array<string | null>): string | null {
  const present = filters.filter((f): f is string => Boolean(f));
  if (present.length === 0) return null;
  if (present.length === 1) return present[0]!;
  return `and(${present.map((f) => `or(${f})`).join(',')})`;
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
  if (!isSupabaseConfigured()) {
    return demoList(
      filterDemoCompanies(filter).filter((c) =>
        matchesSearch([c.name, c.vatNumber, c.registrationNumber, c.email], q),
      ),
    );
  }
  await requireAdmin();

  try {
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const supabase = createAdminClient();

    let builder = supabase
      .from('companies')
      .select('id, name, status, created_at, vat_number, registration_number, email, city')
      .is('deleted_at', null);
    if (filter === AWAITING_FILTER) builder = builder.in('status', [...AWAITING_COMPANY_STATUSES]);
    else if (filter && filter !== 'all') builder = builder.eq('status', filter);
    const orFilter = combineOrFilters(
      q ? searchOrFilter(['name', 'vat_number', 'registration_number', 'email'], q) : null,
      cursorFilterOf(query.cursor),
    );
    if (orFilter) builder = builder.or(orFilter);

    const { data, error } = await builder
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(ADMIN_PAGE_SIZE + 1);
    if (error) throw error;

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

type SupabaseAdmin = ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>;

/** Cel nieodnaleziony albo usunięty. */
const DELETED_TARGET: AdminReportTarget = { label: null, href: null, preview: null, deleted: true };

/**
 * Cele zgłoszeń (#416) — jeden batchowy odczyt na typ (bez N+1). Błąd któregokolwiek odczytu
 * rzuca (lista zgłoszeń bez celów = rozstrzyganie na ślepo, więc to błąd, nie pusta treść).
 */
async function loadReportTargets(
  supabase: SupabaseAdmin,
  rows: Record<string, unknown>[],
): Promise<Map<string, AdminReportTarget>> {
  const idsOf = (type: string) => [
    ...new Set(
      rows
        .filter((r) => asString(r['target_type']) === type)
        .map((r) => asString(r['target_id']))
        .filter((id) => id.length > 0),
    ),
  ];
  const targets = new Map<string, AdminReportTarget>();
  const key = (type: string, id: string) => `${type}:${id}`;

  const jobIds = idsOf('job');
  const companyIds = idsOf('company');
  const userIds = idsOf('user');
  const messageIds = idsOf('message');

  const [jobs, companies, users, messages] = await Promise.all([
    jobIds.length
      ? supabase.from('jobs').select('id, title, slug, status, deleted_at').in('id', jobIds)
      : null,
    companyIds.length
      ? supabase.from('companies').select('id, name, deleted_at').in('id', companyIds)
      : null,
    userIds.length
      ? supabase
          .from('profiles')
          .select('id, first_name, last_name, email, deleted_at')
          .in('id', userIds)
      : null,
    messageIds.length
      ? supabase.from('messages').select('id, body, deleted_at').in('id', messageIds)
      : null,
  ]);
  for (const res of [jobs, companies, users, messages]) {
    if (res?.error) throw res.error;
  }

  for (const job of asRows(jobs?.data)) {
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
  for (const company of asRows(companies?.data)) {
    if (asNullableString(company['deleted_at'])) continue;
    const name = asNullableString(company['name']);
    targets.set(key('company', asString(company['id'])), {
      label: name,
      href: name ? { pathname: '/admin/firmy', query: { q: name } } : null,
      preview: null,
      deleted: false,
    });
  }
  for (const user of asRows(users?.data)) {
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
  for (const message of asRows(messages?.data)) {
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

/**
 * Lista zgłoszeń (#416): filtr statusu (domyślnie otwarte + w analizie), cel zgłoszenia, nazwa
 * zgłaszającego, stronicowanie kursorem (#418). Bez env → DEMO.
 */
export async function listReports(
  query: AdminReportsQuery = {},
): Promise<AdminListResult<AdminReportRow>> {
  const statuses = reportStatusesFor(parseReportFilter(query.status));
  const kind = parseReportKindFilter(query.kind);
  if (!isSupabaseConfigured()) {
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
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const supabase = createAdminClient();

    let builder = supabase
      .from('reports')
      .select(
        'id, reporter_id, target_type, target_id, reason, details, status, created_at, kind, case_number, due_at, content_url, reporter_name, reporter_email, target_snapshot, decision_id, review_priority, review_flag',
      );
    if (statuses) builder = builder.in('status', statuses);
    if (kind !== 'all') builder = builder.eq('kind', kind);
    const orFilter = cursorFilterOf(query.cursor);
    if (orFilter) builder = builder.or(orFilter);

    const { data, error } = await builder
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(ADMIN_PAGE_SIZE + 1);
    if (error) throw error;

    const rows = asRows(data);

    // Nazwy zgłaszających — jeden batchowy odczyt po unikalnych id (unikamy N+1 i zależności od nazw FK).
    const reporterIds = [
      ...new Set(rows.map((r) => asString(r['reporter_id'])).filter((id) => id.length > 0)),
    ];
    const nameById = new Map<string, string>();
    if (reporterIds.length > 0) {
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, first_name, last_name')
        .in('id', reporterIds);
      if (profilesError) throw profilesError;
      for (const profile of asRows(profiles)) {
        nameById.set(asString(profile['id']), fullName(profile));
      }
    }

    // Historia spraw DSA (#41) — jeden odczyt dla całej strony.
    const dsaIds = rows.filter((r) => asString(r['kind']) === 'dsa_notice').map((r) => asString(r['id']));
    const eventsById = new Map<string, AdminReportEvent[]>();
    if (dsaIds.length > 0) {
      const { data: events, error: eventsError } = await supabase
        .from('report_events')
        .select('report_id, event_type, to_status, created_at')
        .in('report_id', dsaIds)
        .order('id', { ascending: true });
      if (eventsError) throw eventsError;
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
    const decisionIds = rows.map((r) => asString(r['decision_id'])).filter((id) => id.length > 0);
    const decisionById = new Map<string, AdminModerationDecision>();
    if (decisionIds.length > 0) {
      const [{ data: decisions, error: decisionsError }, { data: restorations, error: restorationsError }] =
        await Promise.all([
          supabase
            .from('moderation_decisions')
            .select('id, reference, decision, facts, ground_type, ground_reference, automated_detection, decided_at')
            .in('id', decisionIds),
          supabase
            .from('moderation_restorations')
            .select('decision_id, reason, restored_at')
            .in('decision_id', decisionIds),
        ]);
      if (decisionsError) throw decisionsError;
      if (restorationsError) throw restorationsError;
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

    const targets = await loadReportTargets(supabase, rows);

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
  if (!isSupabaseConfigured()) {
    return demoList(
      DEMO_USERS.filter(
        (u) => (!role || u.role === role) && matchesSearch([u.name, u.email], q),
      ),
    );
  }
  await requireAdmin();

  try {
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const supabase = createAdminClient();

    let builder = supabase
      .from('profiles')
      .select('id, first_name, last_name, email, role, created_at')
      .is('deleted_at', null);
    if (role) builder = builder.eq('role', role);
    const orFilter = combineOrFilters(
      q ? searchOrFilter(['first_name', 'last_name', 'email'], q) : null,
      cursorFilterOf(query.cursor),
    );
    if (orFilter) builder = builder.or(orFilter);

    const { data, error } = await builder
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(ADMIN_PAGE_SIZE + 1);
    if (error) throw error;

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

  if (!isSupabaseConfigured()) {
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
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const supabase = createAdminClient();

    // Aktor po nazwie/e-mailu → id profili (max 100 dopasowań); brak dopasowań = pusta lista.
    let actorIdsFilter: string[] | null = null;
    const systemActor = actorQuery?.toLowerCase() === AUDIT_ACTOR_SYSTEM;
    if (actorQuery && !systemActor) {
      const { data: actors, error: actorsError } = await supabase
        .from('profiles')
        .select('id')
        .or(searchOrFilter(['first_name', 'last_name', 'email'], actorQuery))
        .limit(100);
      if (actorsError) throw actorsError;
      actorIdsFilter = asRows(actors)
        .map((r) => asString(r['id']))
        .filter(Boolean);
      if (actorIdsFilter.length === 0) return { status: 'ok', rows: [], nextCursor: null };
    }

    let builder = supabase
      .from('audit_logs')
      .select('id, actor_id, action, entity_type, entity_id, before_data, after_data, created_at');
    if (entity) builder = builder.eq('entity_type', entity);
    if (action) builder = builder.eq('action', action);
    if (entityId) builder = builder.eq('entity_id', entityId);
    if (fromIso) builder = builder.gte('created_at', fromIso);
    if (toIso) builder = builder.lt('created_at', toIso);
    if (systemActor) builder = builder.is('actor_id', null);
    if (actorIdsFilter) builder = builder.in('actor_id', actorIdsFilter);

    const orFilter = cursorFilterOf(query.cursor);
    if (orFilter) builder = builder.or(orFilter);

    const { data, error } = await builder
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(ADMIN_PAGE_SIZE + 1);
    if (error) throw error;
    const rows = asRows(data);

    const uniq = (values: string[]) => [...new Set(values.filter((v) => v.length > 0))];
    const actorIds = uniq(rows.map((r) => asString(r['actor_id'])));
    const companyIds = uniq(
      rows.filter((r) => asString(r['entity_type']) === 'company').map((r) => asString(r['entity_id'])),
    );

    const [actorsRes, companiesRes] = await Promise.all([
      actorIds.length
        ? supabase.from('profiles').select('id, first_name, last_name, email').in('id', actorIds)
        : null,
      companyIds.length
        ? supabase.from('companies').select('id, name, deleted_at').in('id', companyIds)
        : null,
    ]);
    if (actorsRes?.error) throw actorsRes.error;
    if (companiesRes?.error) throw companiesRes.error;

    const actorName = new Map<string, string | null>();
    for (const p of asRows(actorsRes?.data)) {
      const name = fullName(p);
      actorName.set(asString(p['id']), name.length > 0 ? name : asNullableString(p['email']));
    }
    const companyName = new Map<string, { name: string | null; deleted: boolean }>();
    for (const c of asRows(companiesRes?.data)) {
      companyName.set(asString(c['id']), {
        name: asNullableString(c['name']),
        deleted: Boolean(asNullableString(c['deleted_at'])),
      });
    }

    return toPage(
      rows.map((row) => {
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
            entityType === 'company' || asString(row['action']) === 'moderation.restored'
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
 * stan `load_error` pozwala i tak sprawdzić numer ręcznie.
 */
async function readStoredViesCheck(
  supabase: ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>,
  companyId: string,
): Promise<{ stored: StoredViesCheck | null; failed: boolean }> {
  try {
    const { data, error } = await supabase
      .from('company_vies_checks')
      .select('vat_number, result, vies_name, checked_at')
      .eq('company_id', companyId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { stored: null, failed: false };
    const row = asRecord(data);
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
  } catch (error) {
    captureError(error, { area: 'admin.readStoredViesCheck' });
    return { stored: null, failed: true };
  }
}

/**
 * Szczegół firmy dla decyzji admina (#310): dane rejestrowe, uzasadnienie ostatniej decyzji,
 * członkowie (z rolą i aktywnością) oraz najnowsze oferty. Nieistniejąca/usunięta firma albo
 * zły identyfikator → `not_found`; błąd któregokolwiek odczytu → `error` (bez częściowych danych).
 */
export async function getCompanyDetail(id: string): Promise<AdminCompanyDetailResult> {
  if (!isSupabaseConfigured()) return demoCompanyDetail(id);
  await requireAdmin();

  const uuid = parseUuid(id);
  if (!uuid) return { status: 'not_found' };

  try {
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const supabase = createAdminClient();

    const [companyRes, membersRes, jobsRes] = await Promise.all([
      supabase
        .from('companies')
        .select(
          'id, name, status, status_reason, created_at, verified_at, vat_number, registration_number, email, phone, website, address, postal_code, city, region, country, industry, description',
        )
        .eq('id', uuid)
        .is('deleted_at', null)
        .maybeSingle(),
      supabase
        .from('company_members')
        .select(
          'id, role, is_active, joined_at, created_at, profiles!company_members_profile_id_fkey(first_name, last_name, email)',
        )
        .eq('company_id', uuid)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true }),
      supabase
        .from('jobs')
        .select('id, title, status, slug, created_at', { count: 'exact' })
        .eq('company_id', uuid)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(ADMIN_COMPANY_JOBS_LIMIT),
    ]);
    if (companyRes.error) throw companyRes.error;
    if (membersRes.error) throw membersRes.error;
    if (jobsRes.error) throw jobsRes.error;
    if (!companyRes.data) return { status: 'not_found' };

    const c = asRecord(companyRes.data);
    const status = asString(c['status'], 'unverified');
    const vatSource = companyVatSource(
      asNullableString(c['vat_number']),
      asNullableString(c['registration_number']),
    );
    const viesRead = vatSource
      ? await readStoredViesCheck(supabase, uuid)
      : { stored: null, failed: false };
    const jobs = asRows(jobsRes.data).map((row) => ({
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
        members: asRows(membersRes.data).map((row) => {
          const profile = asRecord(
            Array.isArray(row['profiles']) ? row['profiles'][0] : row['profiles'],
          );
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
        jobsTotal: typeof jobsRes.count === 'number' ? jobsRes.count : jobs.length,
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

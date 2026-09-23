/**
 * Warstwa danych panelu administratora — Pracuj.be (Etap 7g).
 *
 * ⚠️ ODCZYTY przez `createAdminClient()` (service-role, OMIJA RLS). Funkcje ZAKŁADAJĄ, że
 * wywołujący (layout/strony `/admin/*`) potwierdził już rolę `admin` — guard w
 * `admin/layout.tsx`. Klient service-role importowany LENIWIE, żeby moduł nie ciągnął
 * `server-only`/klienta do bundla trybu DEMO oraz żeby build bez env przechodził.
 *
 * Bez konfiguracji Supabase (`isSupabaseConfigured() === false`) zwracamy dane DEMO —
 * dzięki temu panel renderuje się w podglądzie/buildzie bez backendu.
 */

import { isSupabaseConfigured } from '@/lib/env';
import { captureError } from '@/lib/sentry';

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
      /** true, gdy lista obcięta do `ADMIN_MAX_ROWS`. */ truncated: boolean;
    }
  | { status: 'error' };

/** Wynik odczytu statystyk: błąd jest jawny, nie udaje zer (#311). */
export type AdminStatsResult = { status: 'ok'; stats: AdminStats } | { status: 'error' };

/** Statusy firm czekających na decyzję admina (kolejka weryfikacji, #307). */
export const AWAITING_COMPANY_STATUSES = ['unverified', 'pending'] as const;

/** Wartość filtra listy firm dla kolejki weryfikacji (`?status=awaiting`). */
export const AWAITING_FILTER = 'awaiting';

export interface AdminReportRow {
  id: string;
  /** `report_target_type`: job/company/user/message. */
  targetType: string;
  targetId: string;
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

/* ---------------------------------------------------------------------------
 * Dane DEMO (fallback bez env)
 * ------------------------------------------------------------------------- */

const DEMO_STATS: AdminStats = {
  companies: 12,
  pendingCompanies: 4,
  users: 148,
  openReports: 2,
};

const DEMO_COMPANIES: AdminCompanyRow[] = [
  { id: 'demo-c1', name: 'AGO Jobs & HR', status: 'verified', createdAt: '2025-01-15T09:00:00.000Z', vatNumber: 'BE0123456789', registrationNumber: '0123.456.789', email: 'jobs@example.com', city: 'Antwerpen' },
  { id: 'demo-c2', name: 'Bouwbedrijf De Vos', status: 'pending', createdAt: '2025-02-03T11:30:00.000Z', vatNumber: 'BE0987654321', registrationNumber: null, email: 'info@example.com', city: 'Gent' },
  { id: 'demo-c3', name: 'Logistiek Antwerpen NV', status: 'pending', createdAt: '2025-02-10T08:15:00.000Z', vatNumber: null, registrationNumber: null, email: null, city: null },
  { id: 'demo-c4', name: 'Horeca Brussel Group', status: 'unverified', createdAt: '2025-02-18T14:45:00.000Z', vatNumber: null, registrationNumber: null, email: null, city: null },
  { id: 'demo-c5', name: 'CleanPro Services', status: 'rejected', createdAt: '2025-01-28T10:00:00.000Z', vatNumber: null, registrationNumber: null, email: null, city: null },
  { id: 'demo-c6', name: 'TransEuro Trucking', status: 'suspended', createdAt: '2024-12-11T16:20:00.000Z', vatNumber: null, registrationNumber: null, email: null, city: null },
  { id: 'demo-c7', name: 'Flanders Food Factory', status: 'pending', createdAt: '2025-02-20T09:05:00.000Z', vatNumber: null, registrationNumber: null, email: null, city: null },
];

const DEMO_REPORTS: AdminReportRow[] = [
  {
    id: 'demo-r1',
    targetType: 'job',
    targetId: 'demo-job-1',
    reason: 'spam',
    details: 'Oferta wygląda na duplikat i zawiera link do zewnętrznego formularza.',
    status: 'open',
    reporterName: 'Adam Kowalski',
    createdAt: '2025-02-19T12:00:00.000Z',
  },
  {
    id: 'demo-r2',
    targetType: 'company',
    targetId: 'demo-c6',
    reason: 'misleading',
    details: null,
    status: 'open',
    reporterName: 'Marta Nowak',
    createdAt: '2025-02-15T18:30:00.000Z',
  },
  {
    id: 'demo-r3',
    targetType: 'message',
    targetId: 'demo-msg-9',
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

/** Limit wierszy list admina (brak paginacji — P2-04); UI informuje o obcięciu. */
export const ADMIN_MAX_ROWS = 200;

/** Odczyt listy z limitem: pobieramy o 1 więcej, żeby wiedzieć, czy lista jest obcięta. */
function toList<T>(rows: T[]): AdminListResult<T> {
  return {
    status: 'ok',
    rows: rows.slice(0, ADMIN_MAX_ROWS),
    truncated: rows.length > ADMIN_MAX_ROWS,
  };
}

function demoList<T>(rows: T[]): AdminListResult<T> {
  return { status: 'ok', rows, truncated: false };
}

/* ---------------------------------------------------------------------------
 * Publiczne API
 * ------------------------------------------------------------------------- */

/** Kafelki statystyk dashboardu admina. Bez env → dane DEMO. Błąd dowolnego licznika → `error`. */
export async function getAdminStats(): Promise<AdminStatsResult> {
  if (!isSupabaseConfigured()) return { status: 'ok', stats: DEMO_STATS };

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

/**
 * Lista firm (opcjonalnie filtr statusu; `awaiting` = kolejka weryfikacji). Bez env → DEMO.
 */
export async function listCompanies(filter?: string): Promise<AdminListResult<AdminCompanyRow>> {
  if (!isSupabaseConfigured()) return demoList(filterDemoCompanies(filter));

  try {
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const supabase = createAdminClient();

    let query = supabase
      .from('companies')
      .select('id, name, status, created_at, vat_number, registration_number, email, city')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(ADMIN_MAX_ROWS + 1);
    if (filter === AWAITING_FILTER) query = query.in('status', [...AWAITING_COMPANY_STATUSES]);
    else if (filter && filter !== 'all') query = query.eq('status', filter);

    const { data, error } = await query;
    if (error) throw error;

    return toList(
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
    );
  } catch (error) {
    captureError(error, { area: 'admin.listCompanies' });
    return { status: 'error' };
  }
}

/** Lista zgłoszeń (najnowsze pierwsze) z nazwą zgłaszającego. Bez env → DEMO. */
export async function listReports(): Promise<AdminListResult<AdminReportRow>> {
  if (!isSupabaseConfigured()) return demoList(DEMO_REPORTS);

  try {
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from('reports')
      .select('id, reporter_id, target_type, target_id, reason, details, status, created_at')
      .order('created_at', { ascending: false })
      .limit(ADMIN_MAX_ROWS + 1);
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

    return toList(
      rows.map((row) => {
        const reporterId = asString(row['reporter_id']);
        const name = reporterId ? (nameById.get(reporterId) ?? '') : '';
        return {
          id: asString(row['id']),
          targetType: asString(row['target_type']),
          targetId: asString(row['target_id']),
          reason: asString(row['reason']),
          details: asNullableString(row['details']),
          status: asString(row['status'], 'open'),
          reporterName: name.length > 0 ? name : null,
          createdAt: asNullableString(row['created_at']),
        };
      }),
    );
  } catch (error) {
    captureError(error, { area: 'admin.listReports' });
    return { status: 'error' };
  }
}

/** Lista kont użytkowników (tylko odczyt). Bez env → DEMO. */
export async function listUsers(): Promise<AdminListResult<AdminUserRow>> {
  if (!isSupabaseConfigured()) return demoList(DEMO_USERS);

  try {
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from('profiles')
      .select('id, first_name, last_name, email, role, created_at')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(ADMIN_MAX_ROWS + 1);
    if (error) throw error;

    return toList(
      asRows(data).map((row) => ({
        id: asString(row['id']),
        name: fullName(row),
        email: asNullableString(row['email']),
        role: asString(row['role'], 'candidate'),
        createdAt: asNullableString(row['created_at']),
      })),
    );
  } catch (error) {
    captureError(error, { area: 'admin.listUsers' });
    return { status: 'error' };
  }
}

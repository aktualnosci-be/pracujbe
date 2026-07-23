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
  /** Firmy oczekujące na weryfikację (status `pending`). */
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
}

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
  pendingCompanies: 3,
  users: 148,
  openReports: 2,
};

const DEMO_COMPANIES: AdminCompanyRow[] = [
  { id: 'demo-c1', name: 'AGO Jobs & HR', status: 'verified', createdAt: '2025-01-15T09:00:00.000Z' },
  { id: 'demo-c2', name: 'Bouwbedrijf De Vos', status: 'pending', createdAt: '2025-02-03T11:30:00.000Z' },
  { id: 'demo-c3', name: 'Logistiek Antwerpen NV', status: 'pending', createdAt: '2025-02-10T08:15:00.000Z' },
  { id: 'demo-c4', name: 'Horeca Brussel Group', status: 'unverified', createdAt: '2025-02-18T14:45:00.000Z' },
  { id: 'demo-c5', name: 'CleanPro Services', status: 'rejected', createdAt: '2025-01-28T10:00:00.000Z' },
  { id: 'demo-c6', name: 'TransEuro Trucking', status: 'suspended', createdAt: '2024-12-11T16:20:00.000Z' },
  { id: 'demo-c7', name: 'Flanders Food Factory', status: 'pending', createdAt: '2025-02-20T09:05:00.000Z' },
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
  return DEMO_COMPANIES.filter((c) => c.status === filter);
}

const MAX_ROWS = 200;

/* ---------------------------------------------------------------------------
 * Publiczne API
 * ------------------------------------------------------------------------- */

/** Kafelki statystyk dashboardu admina. Bez env → dane DEMO. */
export async function getAdminStats(): Promise<AdminStats> {
  if (!isSupabaseConfigured()) return DEMO_STATS;

  try {
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const supabase = createAdminClient();

    const [companies, pending, users, reports] = await Promise.all([
      supabase.from('companies').select('id', { count: 'exact', head: true }).is('deleted_at', null),
      supabase
        .from('companies')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')
        .is('deleted_at', null),
      supabase.from('profiles').select('id', { count: 'exact', head: true }).is('deleted_at', null),
      supabase.from('reports').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    ]);

    return {
      companies: companies.count ?? 0,
      pendingCompanies: pending.count ?? 0,
      users: users.count ?? 0,
      openReports: reports.count ?? 0,
    };
  } catch (error) {
    captureError(error, { area: 'admin.getAdminStats' });
    return { companies: 0, pendingCompanies: 0, users: 0, openReports: 0 };
  }
}

/** Lista firm (opcjonalnie filtr statusu). Bez env → DEMO. */
export async function listCompanies(filter?: string): Promise<AdminCompanyRow[]> {
  if (!isSupabaseConfigured()) return filterDemoCompanies(filter);

  try {
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const supabase = createAdminClient();

    let query = supabase
      .from('companies')
      .select('id, name, status, created_at')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(MAX_ROWS);
    if (filter && filter !== 'all') query = query.eq('status', filter);

    const { data, error } = await query;
    if (error) throw error;

    return asRows(data).map((row) => ({
      id: asString(row['id']),
      name: asString(row['name']),
      status: asString(row['status'], 'unverified'),
      createdAt: asNullableString(row['created_at']),
    }));
  } catch (error) {
    captureError(error, { area: 'admin.listCompanies' });
    return [];
  }
}

/** Lista zgłoszeń (najnowsze pierwsze) z nazwą zgłaszającego. Bez env → DEMO. */
export async function listReports(): Promise<AdminReportRow[]> {
  if (!isSupabaseConfigured()) return DEMO_REPORTS;

  try {
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from('reports')
      .select('id, reporter_id, target_type, target_id, reason, details, status, created_at')
      .order('created_at', { ascending: false })
      .limit(MAX_ROWS);
    if (error) throw error;

    const rows = asRows(data);

    // Nazwy zgłaszających — jeden batchowy odczyt po unikalnych id (unikamy N+1 i zależności od nazw FK).
    const reporterIds = [
      ...new Set(rows.map((r) => asString(r['reporter_id'])).filter((id) => id.length > 0)),
    ];
    const nameById = new Map<string, string>();
    if (reporterIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, first_name, last_name')
        .in('id', reporterIds);
      for (const profile of asRows(profiles)) {
        nameById.set(asString(profile['id']), fullName(profile));
      }
    }

    return rows.map((row) => {
      const reporterId = asString(row['reporter_id']);
      const name = reporterId ? nameById.get(reporterId) ?? '' : '';
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
    });
  } catch (error) {
    captureError(error, { area: 'admin.listReports' });
    return [];
  }
}

/** Lista kont użytkowników (tylko odczyt). Bez env → DEMO. */
export async function listUsers(): Promise<AdminUserRow[]> {
  if (!isSupabaseConfigured()) return DEMO_USERS;

  try {
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from('profiles')
      .select('id, first_name, last_name, email, role, created_at')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(MAX_ROWS);
    if (error) throw error;

    return asRows(data).map((row) => ({
      id: asString(row['id']),
      name: fullName(row),
      email: asNullableString(row['email']),
      role: asString(row['role'], 'candidate'),
      createdAt: asNullableString(row['created_at']),
    }));
  } catch (error) {
    captureError(error, { area: 'admin.listUsers' });
    return [];
  }
}

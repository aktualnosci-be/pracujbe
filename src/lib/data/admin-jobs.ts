/**
 * Lista ofert w panelu administratora (`/admin/oferty`) — tylko odczyt.
 *
 * Wszystkie nieusunięte oferty wszystkich firm: filtr statusu efektywnego (aktywna po terminie
 * = wygasła, `moderated` = blokada decyzji moderacyjnej, 0099), filtr firmy (`firma` = UUID),
 * wyszukiwanie po tytule, slugu, mieście, nazwie firmy i identyfikatorze oferty, stronicowanie
 * kursorem (`created_at`, `id`) jak pozostałe listy admina (#418).
 *
 * ⚠️ Odczyt przez `withServiceRole()` (omija RLS) — dlatego `requireAdmin()` PRZED transakcją
 * (brak sesji / inna rola / błąd tożsamości → `notFound()`). Jedna lista = jedna transakcja;
 * błąd dowolnego odczytu = jawny stan `error` (#311). Bez konfiguracji bazy → dane DEMO.
 * Odczyt niczego nie zmienia, więc nie trafia do `audit_logs` (jak inne listy panelu).
 */

import {
  adminJobFilterCondition,
  type AdminJobFilter,
} from '@/lib/admin/job-list-params';
import {
  ADMIN_PAGE_SIZE,
  decodeAdminCursor,
  encodeAdminCursor,
  matchesSearch,
  normalizeAdminSearch,
  parseUuid,
} from '@/lib/admin/list-params';
import { DEMO_COMPANIES, requireAdmin } from '@/lib/data/admin';
import { demoJobs } from '@/lib/data/demo';
import { isPortalDataConfigured, withServiceRole } from '@/lib/db/portal';
import { queryOne, queryRows } from '@/lib/db/sql';
import { captureError } from '@/lib/error-report';
import { effectiveJobStatus } from '@/lib/job-expiry';

export interface AdminJobRow {
  id: string;
  title: string;
  /** Status efektywny: aktywna po `expires_at` = `expired` (#72). */
  status: string;
  slug: string | null;
  city: string | null;
  createdAt: string | null;
  publishedAt: string | null;
  expiresAt: string | null;
  companyId: string;
  companyName: string;
  /** `company_status` firmy oferty. */
  companyStatus: string;
  /** Oferta zablokowana decyzją moderacyjną (0099). */
  moderated: boolean;
  /** Dane demonstracyjne (Invariant #12). */
  isDemo: boolean;
  /**
   * Publiczny adres (bez prefiksu locale) — tylko gdy oferta jest publicznie widoczna:
   * aktywna, przed terminem, firma zweryfikowana, nie demo. Inaczej null (brak martwych linków).
   */
  publicPath: string | null;
}

export interface AdminJobsQuery {
  status?: AdminJobFilter | null;
  q?: string | null;
  /** UUID firmy z URL (niezaufany — walidowany). */
  company?: string | null;
  cursor?: string | null;
}

export type AdminJobsResult =
  | {
      status: 'ok';
      rows: AdminJobRow[];
      nextCursor: string | null;
      /** Firma z filtra `firma` (nazwa do nagłówka) albo null. */
      company: { id: string; name: string } | null;
    }
  | { status: 'error' };

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function nullable(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Publiczny adres oferty tylko dla oferty widocznej publicznie (jak `job_is_public`). */
export function adminJobPublicPath(row: {
  status: string;
  slug: string | null;
  companyStatus: string;
  isDemo: boolean;
}): string | null {
  if (row.isDemo || row.status !== 'active' || row.companyStatus !== 'verified' || !row.slug) {
    return null;
  }
  return `/oferty-pracy/${row.slug}`;
}

/* ---------------------------------------------------------------------------
 * DEMO (bez bazy)
 * ------------------------------------------------------------------------- */

const DEMO_STATUSES = ['active', 'draft', 'paused', 'closed', 'expired', 'active'] as const;

function demoRows(): AdminJobRow[] {
  return demoJobs.slice(0, DEMO_STATUSES.length).map((job, index) => {
    const company = DEMO_COMPANIES[index % DEMO_COMPANIES.length]!;
    const status = DEMO_STATUSES[index] ?? 'draft';
    return {
      id: `${company.id}-job-${index + 1}`,
      title: job.title,
      status,
      slug: job.slug,
      city: job.city ?? null,
      createdAt: company.createdAt,
      publishedAt: status === 'draft' ? null : company.createdAt,
      expiresAt: null,
      companyId: company.id,
      companyName: company.name,
      companyStatus: company.status,
      // Jedna oferta z blokadą moderacyjną — pokazuje oznaczenie w podglądzie.
      moderated: index === 3,
      isDemo: true,
      publicPath: null,
    };
  });
}

function demoResult(query: AdminJobsQuery): AdminJobsResult {
  const q = normalizeAdminSearch(query.q);
  const companyId = query.company ?? null;
  const filter = query.status ?? 'all';
  const rows = demoRows().filter(
    (row) =>
      (filter === 'all' ||
        (filter === 'moderated' ? row.moderated : row.status === filter)) &&
      (!companyId || row.companyId === companyId) &&
      matchesSearch([row.title, row.slug, row.city, row.companyName, row.id], q),
  );
  const company = companyId ? DEMO_COMPANIES.find((c) => c.id === companyId) : undefined;
  return {
    status: 'ok',
    rows,
    nextCursor: null,
    company: company ? { id: company.id, name: company.name } : null,
  };
}

/* ---------------------------------------------------------------------------
 * Odczyt
 * ------------------------------------------------------------------------- */

export async function listAdminJobs(query: AdminJobsQuery = {}): Promise<AdminJobsResult> {
  if (!isPortalDataConfigured()) return demoResult(query);
  await requireAdmin();

  const q = normalizeAdminSearch(query.q);
  const companyId = parseUuid(query.company);
  const values: unknown[] = [];
  const add = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };

  const conditions: string[] = ['j.deleted_at IS NULL'];
  const statusCondition = adminJobFilterCondition(query.status ?? 'all');
  if (statusCondition) conditions.push(statusCondition);
  if (companyId) conditions.push(`j.company_id = ${add(companyId)}::uuid`);
  if (q) {
    // `normalizeAdminSearch` usuwa `%`, `*`, `\`; `_` escapujemy (literał, nie symbol LIKE).
    const pattern = add(`%${q.replace(/_/g, '\\_')}%`);
    conditions.push(
      `(${['j.title', 'j.slug', 'j.city', 'c.name', 'j.id::text']
        .map((column) => `${column} ILIKE ${pattern}`)
        .join(' OR ')})`,
    );
  }
  const cursor = decodeAdminCursor(query.cursor);
  if (cursor) {
    conditions.push(
      `(j.created_at, j.id) < (${add(cursor.createdAt)}::timestamptz, ${add(cursor.id)}::uuid)`,
    );
  }
  const limit = add(ADMIN_PAGE_SIZE + 1);

  try {
    const loaded = await withServiceRole(async (tx) => {
      const rows = await queryRows(tx, 'admin.jobs',
        `SELECT j.id, j.title, j.status, j.slug, j.city, j.created_at, j.published_at,
                j.expires_at, j.is_demo, (j.moderation_decision_id IS NOT NULL) AS moderated,
                c.id AS company_id, c.name AS company_name, c.status AS company_status,
                c.is_demo AS company_is_demo
           FROM public.jobs j
           JOIN public.companies c ON c.id = j.company_id
          WHERE ${conditions.join(' AND ')}
          ORDER BY j.created_at DESC, j.id DESC
          LIMIT ${limit}`, values);
      const company = companyId
        ? await queryOne(tx, 'admin.jobs-company',
            'SELECT id, name FROM public.companies WHERE id = $1 AND deleted_at IS NULL',
            [companyId])
        : null;
      return { rows, company };
    });

    const mapped: AdminJobRow[] = loaded.rows.map((row) => {
      const expiresAt = nullable(row['expires_at']);
      const status = effectiveJobStatus(str(row['status'], 'draft'), expiresAt);
      const base = {
        id: str(row['id']),
        title: str(row['title']),
        status,
        slug: nullable(row['slug']),
        city: nullable(row['city']),
        createdAt: nullable(row['created_at']),
        publishedAt: nullable(row['published_at']),
        expiresAt,
        companyId: str(row['company_id']),
        companyName: str(row['company_name']),
        companyStatus: str(row['company_status'], 'unverified'),
        moderated: row['moderated'] === true,
        isDemo: row['is_demo'] === true || row['company_is_demo'] === true,
      };
      return { ...base, publicPath: adminJobPublicPath(base) };
    });

    const page = mapped.slice(0, ADMIN_PAGE_SIZE);
    const last = page[page.length - 1];
    const nextCursor =
      mapped.length > ADMIN_PAGE_SIZE && last?.createdAt
        ? encodeAdminCursor({ createdAt: last.createdAt, id: last.id })
        : null;
    const company = loaded.company
      ? { id: str(loaded.company['id']), name: str(loaded.company['name']) }
      : null;
    return { status: 'ok', rows: page, nextCursor, company };
  } catch (error) {
    captureError(error, { area: 'admin.listAdminJobs' });
    return { status: 'error' };
  }
}

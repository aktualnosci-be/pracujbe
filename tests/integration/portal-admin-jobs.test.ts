import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { actAs, realSession } from './support/real-portal';
import { startPortalDb } from './support/portal-db';

vi.mock('@/lib/db/portal', async () => (await import('./support/real-portal')).realPortal());
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

const { listAdminJobs } = await import('../../src/lib/data/admin-jobs');
const { ADMIN_PAGE_SIZE } = await import('../../src/lib/admin/list-params');

// Lista ofert panelu admina (`/admin/oferty`) na PostgreSQL 16: kursor przechodzi przez
// wszystkie nieusunięte oferty bez duplikatów i luk (remisy `created_at`), status efektywny
// (aktywna po terminie = wygasła), filtr firmy i wyszukiwanie po nazwie firmy.
const PER_COMPANY = ADMIN_PAGE_SIZE - 10;

let companyA = '';
let companyB = '';

async function referenceIds(where = 'true'): Promise<string[]> {
  const rows = await realSession.db!.admin.query(
    `SELECT j.id FROM public.jobs j JOIN public.companies c ON c.id = j.company_id
      WHERE j.deleted_at IS NULL AND ${where}
      ORDER BY j.created_at DESC, j.id DESC`);
  return rows.rows.map((r: { id: string }) => r.id);
}

async function allPages(query: Parameters<typeof listAdminJobs>[0]): Promise<{ ids: string[]; pages: number }> {
  const ids: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const result = await listAdminJobs({ ...query, cursor });
    if (result.status !== 'ok') throw new Error('listAdminJobs error');
    ids.push(...result.rows.map((r) => r.id));
    cursor = result.nextCursor;
    pages += 1;
  } while (cursor && pages < 20);
  return { ids, pages };
}

beforeAll(async () => {
  const pg = await startPortalDb();
  realSession.db = pg;
  const adminId = await pg.createUser('candidate', 'pl');
  await pg.admin.query(`UPDATE public.profiles SET role = 'admin' WHERE id = $1`, [adminId]);
  actAs({ id: adminId, role: 'admin' });
  companyA = (await pg.admin.query(
    `INSERT INTO public.companies(name, status) VALUES ('Bouw Alfa IT', 'verified') RETURNING id`)).rows[0].id;
  companyB = (await pg.admin.query(
    `INSERT INTO public.companies(name, status) VALUES ('Logistiek Beta IT', 'pending') RETURNING id`)).rows[0].id;

  // Wstawienie bez triggerów publikacji (tylko dane testu); CHECK-i obowiązują.
  const client = await pg.admin.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL session_replication_role = replica');
    for (const company of [companyA, companyB]) {
      await client.query(
        `INSERT INTO public.jobs(company_id, slug, title, status, category, contract_type, city, region,
           expires_at, deleted_at, created_at)
         SELECT $1::uuid, 'it-' || $1::text || '-' || g, 'Oferta IT ' || g,
                (ARRAY['active','draft','paused','closed','expired'])[1 + g % 5]::job_status,
                'warehouse', 'permanent', 'Gent', 'Oost-Vlaanderen',
                CASE WHEN g % 10 = 0 THEN now() - interval '1 day' ELSE now() + interval '30 days' END,
                CASE WHEN g % 17 = 0 THEN now() END,
                timestamptz '2026-09-20 10:00:00.654321+00' + ((g / 3) || ' minutes')::interval
           FROM generate_series(1, ${PER_COMPANY}) g`,
        [company],
      );
    }
    await client.query('COMMIT');
  } finally {
    client.release();
  }
});

afterAll(async () => { await realSession.db?.stop(); });

describe('lista ofert panelu admina', () => {
  it('stronicowanie = pełny porządek z bazy bez usuniętych, bez duplikatów i luk', async () => {
    const reference = await referenceIds();
    expect(reference.length).toBeGreaterThan(ADMIN_PAGE_SIZE);
    const { ids, pages } = await allPages({});
    expect(pages).toBeGreaterThan(1);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(reference);
  });

  it('aktywna po terminie jest wśród wygasłych, nie wśród aktywnych', async () => {
    const pastActive = await referenceIds(`j.status = 'active' AND j.expires_at <= now()`);
    expect(pastActive.length).toBeGreaterThan(0);
    const expired = await allPages({ status: 'expired' });
    const active = await allPages({ status: 'active' });
    for (const id of pastActive) {
      expect(expired.ids).toContain(id);
      expect(active.ids).not.toContain(id);
    }
    expect(expired.ids).toEqual(await referenceIds(
      `(j.status = 'expired' OR (j.status = 'active' AND j.expires_at <= now()))`));
    const first = await listAdminJobs({ status: 'expired' });
    if (first.status !== 'ok') throw new Error('error');
    expect(first.rows.every((row) => row.status === 'expired' && row.publicPath === null)).toBe(true);
  });

  it('filtr firmy i wyszukiwanie po nazwie firmy', async () => {
    const byCompany = await allPages({ company: companyB });
    expect(byCompany.ids).toEqual(await referenceIds(`j.company_id = '${companyB}'`));
    const header = await listAdminJobs({ company: companyB });
    expect(header.status === 'ok' && header.company?.name).toBe('Logistiek Beta IT');
    const bySearch = await allPages({ q: 'alfa' });
    expect(bySearch.ids).toEqual(await referenceIds(`j.company_id = '${companyA}'`));
  });

  it('publiczny link tylko dla aktywnej oferty zweryfikowanej firmy', async () => {
    const pending = await listAdminJobs({ status: 'active', company: companyB });
    if (pending.status !== 'ok') throw new Error('error');
    expect(pending.rows.length).toBeGreaterThan(0);
    expect(pending.rows.every((row) => row.publicPath === null)).toBe(true);
    const verified = await listAdminJobs({ status: 'active', company: companyA });
    if (verified.status !== 'ok') throw new Error('error');
    expect(verified.rows.every((row) => row.publicPath === `/oferty-pracy/${row.slug}`)).toBe(true);
    expect(verified.rows.length).toBeGreaterThan(0);
  });

  it('bez roli admina: brak odczytu', async () => {
    actAs({ id: '00000000-0000-4000-8000-000000000001', role: 'employer' });
    await expect(listAdminJobs()).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

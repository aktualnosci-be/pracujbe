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

const data = await import('../../src/lib/data/admin');
const { ADMIN_PAGE_SIZE } = await import('../../src/lib/admin/list-params');

// Kolejka „Treść ofert” (#1220, audyt 29.09 BIZ-2) na PostgreSQL 16: filtr „oczekujące” =
// tylko przegląd BIEŻĄCEJ treści oferty, liczony w SQL przed LIMIT. Każdy zapis innej treści
// z sygnałem zostawia nieaktualny wiersz `pending`; dawniej zajmowały one miejsca na stronie
// (filtr w JS po LIMIT), więc pierwsza strona mogła być pusta mimo aktualnych spraw dalej.
const JOBS = ADMIN_PAGE_SIZE + 7;
const STALE_PER_JOB = 3;

let deletedJob = '';

async function referenceIds(): Promise<string[]> {
  const rows = await realSession.db!.admin.query(
    `SELECT r.id FROM public.job_content_reviews r JOIN public.jobs j ON j.id = r.job_id
      WHERE r.status = 'pending' AND j.deleted_at IS NULL
        AND md5(public.job_trust_content(r.job_id)::text) = r.content_fingerprint
      ORDER BY r.created_at DESC, r.id DESC`);
  return rows.rows.map((r: { id: string }) => r.id);
}

async function allPages(status: string): Promise<{ ids: string[]; pages: number; sizes: number[] }> {
  const ids: string[] = [];
  const sizes: number[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const result = await data.listJobContentReviews({ status, cursor });
    if (result.status !== 'ok') throw new Error('listJobContentReviews error');
    ids.push(...result.rows.map((r) => r.id));
    sizes.push(result.rows.length);
    cursor = result.nextCursor;
    pages += 1;
  } while (cursor && pages < 30);
  return { ids, pages, sizes };
}

beforeAll(async () => {
  const pg = await startPortalDb();
  realSession.db = pg;
  const adminId = await pg.createUser('candidate', 'pl');
  await pg.admin.query(`UPDATE public.profiles SET role = 'admin' WHERE id = $1`, [adminId]);
  actAs({ id: adminId, role: 'admin' });
  const company = (await pg.admin.query(
    `INSERT INTO public.companies(name, status) VALUES ('Treść IT', 'verified') RETURNING id`)).rows[0].id;

  // Wstawienie bez triggerów (tylko dane testu); CHECK-i obowiązują. Na każdą ofertę:
  // NOWSZE nieaktualne przeglądy (inny odcisk) i jeden starszy przegląd bieżącej treści —
  // przy filtrze w JS pierwsza strona byłaby wypełniona nieaktualnymi wierszami.
  const client = await pg.admin.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL session_replication_role = replica');
    const jobs = await client.query(
      `INSERT INTO public.jobs(company_id, slug, title, status, category, contract_type, city, region, default_locale)
       SELECT $1::uuid, 'tr-it-' || g, 'Oferta treści ' || g, 'paused', 'warehouse', 'permanent', 'Gent',
              'Oost-Vlaanderen', 'pl'
         FROM generate_series(1, ${JOBS}) g
       RETURNING id`,
      [company],
    );
    const ids = jobs.rows.map((r: { id: string }) => r.id);
    await client.query(
      `INSERT INTO public.job_content_reviews(job_id, content_fingerprint, rule_categories, content, created_at)
       SELECT j.id, md5(public.job_trust_content(j.id)::text), array['off_platform_contact'],
              public.job_trust_content(j.id), timestamptz '2026-09-20 10:00:00+00' + (j.n || ' minutes')::interval
         FROM unnest($1::uuid[]) WITH ORDINALITY AS j(id, n)`,
      [ids],
    );
    await client.query(
      `INSERT INTO public.job_content_reviews(job_id, content_fingerprint, rule_categories, content, created_at)
       SELECT j.id, 'stale-' || s, array['off_platform_contact'], '{}'::jsonb,
              timestamptz '2026-09-25 10:00:00+00' + ((j.n * 10 + s) || ' minutes')::interval
         FROM unnest($1::uuid[]) WITH ORDINALITY AS j(id, n), generate_series(1, ${STALE_PER_JOB}) s`,
      [ids],
    );
    // Oferta usunięta z bieżącym przeglądem — nie trafia do kolejki oczekujących.
    deletedJob = ids[0] ?? '';
    await client.query(`UPDATE public.jobs SET deleted_at = now() WHERE id = $1`, [deletedJob]);
    // Remis created_at w bieżących przeglądach (kursor rozstrzyga id).
    await client.query(
      `UPDATE public.job_content_reviews SET created_at = timestamptz '2026-09-20 12:00:00+00'
        WHERE job_id = ANY($1::uuid[]) AND content_fingerprint NOT LIKE 'stale-%'`,
      [ids.slice(1, 9)],
    );
    await client.query('COMMIT');
  } finally {
    client.release();
  }
});

afterAll(async () => { await realSession.db?.stop(); });

describe('kolejka przeglądu treści ofert (#1220)', () => {
  it('oczekujące: pełne strony samych bieżących przeglądów, kursor bez duplikatów i luk', async () => {
    const reference = await referenceIds();
    expect(reference).toHaveLength(JOBS - 1);
    const { ids, pages, sizes } = await allPages('pending');
    expect(pages).toBe(2);
    expect(sizes[0]).toBe(ADMIN_PAGE_SIZE);
    expect(ids).toEqual(reference);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('kontrola ujemna: bez warunku w SQL pierwsza strona to same nieaktualne przeglądy', async () => {
    // Stary odczyt (filtr po LIMIT): 50 najnowszych `pending` → wszystkie nieaktualne.
    const rows = await realSession.db!.admin.query(
      `SELECT (j.deleted_at IS NULL AND md5(public.job_trust_content(r.job_id)::text) = r.content_fingerprint) AS current
         FROM public.job_content_reviews r JOIN public.jobs j ON j.id = r.job_id
        WHERE r.status = 'pending'
        ORDER BY r.created_at DESC, r.id DESC LIMIT ${ADMIN_PAGE_SIZE + 1}`);
    expect(rows.rows.filter((r: { current: boolean }) => r.current)).toHaveLength(0);
  });

  it('wszystkie: nieaktualne przeglądy nadal widoczne jako historia (current = false)', async () => {
    const { ids } = await allPages('all');
    expect(ids).toHaveLength(JOBS * (STALE_PER_JOB + 1));
    const first = await data.listJobContentReviews({ status: 'all' });
    if (first.status !== 'ok') throw new Error('error');
    expect(first.rows.every((r) => r.current === false)).toBe(true);
  });
});

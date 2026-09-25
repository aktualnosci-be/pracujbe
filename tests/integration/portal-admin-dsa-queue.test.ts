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

// Kolejka przeglądu DSA (#42) na PostgreSQL 16: porządek priorytet ↓, termin ↑ (bez terminu
// na końcu), created_at ↓, id ↓ i kursor, który przechodzi przez wszystkie sprawy bez
// duplikatów i luk — także przy remisach priorytetu, terminu i czasu utworzenia.
const DSA = ADMIN_PAGE_SIZE + 17;
const QUALITY = 9;

/** Pełny porządek referencyjny liczony wprost w bazie. */
async function referenceOrder(flaggedOnly = false): Promise<string[]> {
  const rows = await realSession.db!.admin.query(
    `SELECT id FROM public.reports
      WHERE status IN ('open', 'reviewing')
        ${flaggedOnly ? "AND kind = 'dsa_notice' AND (review_priority > 0 OR review_flag IS NOT NULL)" : ''}
      ORDER BY review_priority DESC, (due_at IS NULL), due_at, created_at DESC, id DESC`);
  return rows.rows.map((r: { id: string }) => r.id);
}

async function allPages(query: Parameters<typeof data.listReports>[0]): Promise<{ ids: string[]; pages: number }> {
  const ids: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const result = await data.listReports({ ...query, cursor });
    if (result.status !== 'ok') throw new Error('listReports error');
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
  const company = (await pg.admin.query(`INSERT INTO public.companies(name, status) VALUES ('Firma DSA IT', 'verified') RETURNING id`)).rows[0].id;

  // Wstawienie bez triggerów niezmienności (tylko dane testu); CHECK-i obowiązują.
  const client = await pg.admin.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL session_replication_role = replica');
    // Remisy: priorytet g % 4, termin z 5 wartości, czas utworzenia co 3 sprawy ten sam.
    await client.query(
      `INSERT INTO public.reports(kind, target_type, target_id, reason, details, status, case_number,
         access_code_hash, idempotency_key, category, reporter_email, reporter_locale, good_faith_at,
         target_snapshot, due_at, review_priority, review_flag, created_at)
       SELECT 'dsa_notice', 'company', $1, 'fraud', 'Opis sprawy ' || g,
              (CASE WHEN g % 7 = 0 THEN 'reviewing' ELSE 'open' END)::report_status,
              'DSA-IT-' || lpad(g::text, 4, '0'), repeat('a', 64), gen_random_uuid(), 'fraud',
              'dsa' || g || '@example.invalid', 'pl', now(), '{}'::jsonb,
              timestamptz '2026-10-01 09:00:00.123456+00' + ((g % 5) || ' hours')::interval,
              (g % 4)::smallint,
              CASE WHEN g % 11 = 0 THEN 'auto: podejrzenie oszustwa' END,
              timestamptz '2026-09-20 10:00:00.654321+00' + ((g / 3) || ' minutes')::interval
         FROM generate_series(1, ${DSA}) g`,
      [company],
    );
    await client.query(
      `INSERT INTO public.reports(target_type, target_id, reason, details, created_at)
       SELECT 'company', $1, 'spam', 'Jakość ' || g,
              timestamptz '2026-09-21 10:00:00+00' + ((g / 2) || ' minutes')::interval
         FROM generate_series(1, ${QUALITY}) g`,
      [company],
    );
    await client.query('COMMIT');
  } finally {
    client.release();
  }
});

afterAll(async () => { await realSession.db?.stop(); });

describe('kolejka DSA według priorytetu (#42)', () => {
  it('stronicowanie w porządku priorytetu = pełny porządek z bazy, bez duplikatów i luk', async () => {
    const reference = await referenceOrder();
    expect(reference).toHaveLength(DSA + QUALITY);
    const { ids, pages } = await allPages({ status: 'active', kind: 'all', sort: 'priority' });
    expect(pages).toBeGreaterThan(1);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(reference);
  });

  it('kontrola ujemna: porządek priorytetu różni się od „najnowsze”, które nadal działa po staremu', async () => {
    const newest = await allPages({ status: 'active', kind: 'all', sort: 'newest' });
    const byDate = (await realSession.db!.admin.query(
      `SELECT id FROM public.reports WHERE status IN ('open','reviewing') ORDER BY created_at DESC, id DESC`)).rows
      .map((r: { id: string }) => r.id);
    expect(newest.ids).toEqual(byDate);
    expect(newest.ids).not.toEqual(await referenceOrder());
  });

  it('domyślna kolejność kolejki DSA = priorytet i termin', async () => {
    const first = await data.listReports({ kind: 'dsa_notice' });
    if (first.status !== 'ok') throw new Error('error');
    const reference = (await referenceOrder()).slice(0, ADMIN_PAGE_SIZE);
    expect(first.rows.map((r) => r.id)).toEqual(reference);
  });

  it('filtr „oflagowane”: tylko sprawy z priorytetem albo flagą, w porządku kolejki', async () => {
    const reference = await referenceOrder(true);
    const { ids } = await allPages({ status: 'active', kind: 'all', sort: 'priority', flagged: true });
    expect(ids).toEqual(reference);
    const result = await data.listReports({ kind: 'dsa_notice', flagged: true });
    if (result.status !== 'ok') throw new Error('error');
    expect(result.rows.every((r) => r.dsa && (r.dsa.reviewPriority > 0 || r.dsa.reviewFlag))).toBe(true);
  });

  it('kursor z porządku „najnowsze” nie przenosi się do kolejki (pierwsza strona, bez błędu)', async () => {
    const newest = await data.listReports({ status: 'active', kind: 'all', sort: 'newest' });
    if (newest.status !== 'ok' || !newest.nextCursor) throw new Error('brak kursora');
    const priority = await data.listReports({ status: 'active', kind: 'all', sort: 'priority', cursor: newest.nextCursor });
    if (priority.status !== 'ok') throw new Error('error');
    expect(priority.rows.map((r) => r.id)).toEqual((await referenceOrder()).slice(0, ADMIN_PAGE_SIZE));
  });

  it('bez roli admina: brak odczytu', async () => {
    actAs({ id: '00000000-0000-4000-8000-000000000001', role: 'candidate' });
    await expect(data.listReports({ sort: 'priority' })).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

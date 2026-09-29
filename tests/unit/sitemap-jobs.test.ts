import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * #1042 (migracja 0965): partie sitemapy ofert wyznaczają kursory (published_at, id), nie
 * pozycje. Atrapa poniżej odtwarza semantykę obu RPC (granice partii, strona kursorem z
 * górną granicą włącznie), a test sprawdza logikę `src/lib/sitemap-jobs.ts`: partie rozłączne,
 * bez dziur i dubli — także gdy WSZYSTKIE oferty mają ten sam `published_at` (remis przez każdą
 * granicę strony i partii). SQL sprawdza `rls.sql` sekcja SM1042 i integracja `public-jobs`.
 */

const state = vi.hoisted(() => ({
  configured: true,
  production: true,
  build: false,
  naive: false,
  rows: [] as { id: string; publishedAt: string; companySlug?: string }[],
  pageCalls: 0,
  failNext: false,
}));

vi.mock('@/lib/env', () => ({
  isDatabaseConfigured: () => state.configured,
  isProductionMode: () => state.production,
}));
vi.mock('@/lib/static-rendering', () => ({ isBuildPhase: () => state.build }));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));
vi.mock('@/lib/db/runtime', () => ({ getDomainPool: async () => ({}) }));

type Cursor = { publishedAt: string; id: string };
const key = (row: Cursor) => `${row.publishedAt}|${row.id}`;
/** Porządek RPC: published_at desc, id desc. */
const before = (a: Cursor, b: Cursor, naive: boolean) =>
  naive ? a.publishedAt < b.publishedAt : key(a) < key(b);

vi.mock('@/lib/db/sitemap-jobs', () => ({
  getSitemapShardStarts: async (_pool: unknown, size: number) => {
    if (state.failNext) {
      state.failNext = false;
      throw new Error('connection reset');
    }
    const sorted = [...state.rows].sort((a, b) => (key(a) < key(b) ? 1 : -1));
    const out: { shardIndex: number; after: Cursor | null }[] = [];
    for (let rn = 0; rn < sorted.length; rn += size) {
      out.push({ shardIndex: rn / size + 1, after: rn === 0 ? null : { ...sorted[rn - 1]! } });
    }
    return out;
  },
  getSitemapJobsPage: async (_pool: unknown, after: Cursor | null, until: Cursor | null, limit: number) => {
    state.pageCalls += 1;
    return [...state.rows]
      .sort((a, b) => (key(a) < key(b) ? 1 : -1))
      .filter((row) => (after ? before(row, after, state.naive) : true))
      .filter((row) => (until ? key(row) >= key(until) : true))
      .slice(0, limit)
      .map((row) => ({ ...row, slug: `s-${row.id}`, updatedAt: row.publishedAt, locales: [] }));
  },
}));

const { getSitemapCompanySlugs, getSitemapJobShardStarts, getSitemapJobsShard } = await import('@/lib/sitemap-jobs');

const TIE = '2026-09-01T10:00:00.123456+00:00';
function rows(n: number, at: (i: number) => string = () => TIE) {
  return Array.from({ length: n }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
    publishedAt: at(i),
  }));
}

async function readAll(size: number): Promise<string[]> {
  const starts = await getSitemapJobShardStarts(size);
  const ids: string[] = [];
  for (const { shardIndex } of starts) {
    for (const job of await getSitemapJobsShard(shardIndex, size)) ids.push(job.id);
  }
  return ids;
}

beforeEach(() => {
  state.configured = true;
  state.production = true;
  state.build = false;
  state.naive = false;
  state.pageCalls = 0;
  state.failNext = false;
  state.rows = [];
});

describe('sitemap ofert: partie kursorowe (#1042)', () => {
  it('2500 ofert z jednym published_at: partie po 1000 są rozłączne, bez dziur i dubli', async () => {
    state.rows = rows(2500);
    const starts = await getSitemapJobShardStarts(1000);
    expect(starts.map((s) => s.shardIndex)).toEqual([1, 2, 3]);
    expect(starts[0]!.after).toBeNull();
    // Kursor partii 2 = klucz ostatniej oferty partii 1 (1000. w porządku listy).
    const sorted = [...state.rows].sort((a, b) => (key(a) < key(b) ? 1 : -1));
    expect(starts[1]!.after).toEqual(sorted[999]);

    const sizes: number[] = [];
    const all: string[] = [];
    for (const { shardIndex } of starts) {
      const part = await getSitemapJobsShard(shardIndex, 1000);
      sizes.push(part.length);
      all.push(...part.map((job) => job.id));
    }
    expect(sizes).toEqual([1000, 1000, 500]);
    expect(new Set(all).size).toBe(2500);
    expect(all).toEqual(sorted.map((row) => row.id));
  });

  it('partia kończy się na kursorze następnej także po zmianie katalogu między żądaniami', async () => {
    state.rows = rows(30, (i) => `2026-09-01T10:00:${String(i % 3).padStart(2, '0')}.000000+00:00`);
    const starts = await getSitemapJobShardStarts(10);
    // Między wyliczeniem granic a odczytem partii pojawia się nowa oferta (najnowsza).
    state.rows.push({ id: 'ffffffff-0000-4000-8000-000000000001', publishedAt: '2026-09-01T11:00:00.000000+00:00' });
    const part1 = await getSitemapJobsShard(1, 10);
    const part2 = await getSitemapJobsShard(2, 10);
    // Nowa oferta trafia do partii 1 (najnowsza) — partia 2 nie zmienia zakresu (brak duplikatu).
    expect(part1.some((job) => job.id.startsWith('ffffffff'))).toBe(true);
    expect(part1.map((j) => j.id).filter((id) => part2.some((j) => j.id === id))).toEqual([]);
    expect(starts).toHaveLength(3);
  });

  it('granica dokładnie na wielokrotności rozmiaru strony: brak pustej dodatkowej partii i dubli', async () => {
    state.rows = rows(2000);
    const starts = await getSitemapJobShardStarts(1000);
    expect(starts).toHaveLength(2);
    expect((await readAll(1000))).toHaveLength(2000);
  });

  it('numer partii spoza katalogu = pusta lista, bez odczytu stron', async () => {
    state.rows = rows(10);
    expect(await getSitemapJobsShard(2, 1000)).toEqual([]);
    expect(await getSitemapJobsShard(0, 1000)).toEqual([]);
    expect(state.pageCalls).toBe(0);
  });

  it('brak ofert = brak partii', async () => {
    expect(await getSitemapJobShardStarts(5000)).toEqual([]);
  });

  it('KONTROLA UJEMNA: kursor tylko po published_at (bez id) gubi oferty remisu — test to wykrywa', async () => {
    state.rows = rows(2500);
    state.naive = true;
    const all = await readAll(1000);
    expect(all.length).toBeLessThan(2500);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('sitemap ofert: środowisko i błędy', () => {
  it('błąd bazy: loguje i propaguje AppError (nie zwraca pustej sitemapy)', async () => {
    state.rows = rows(3);
    state.failNext = true;
    await expect(getSitemapJobShardStarts(5000)).rejects.toMatchObject({ code: 'INTERNAL' });
  });

  it('produkcja bez bazy = błąd; poza produkcją i w fazie builda = pusta lista', async () => {
    state.configured = false;
    await expect(getSitemapJobShardStarts(5000)).rejects.toMatchObject({ code: 'INTERNAL' });
    state.production = false;
    expect(await getSitemapJobShardStarts(5000)).toEqual([]);
    expect(await getSitemapJobsShard(1, 5000)).toEqual([]);
    state.configured = true;
    state.build = true;
    state.rows = rows(3);
    expect(await getSitemapJobShardStarts(5000)).toEqual([]);
  });
});

describe('getSitemapCompanySlugs (#1231)', () => {
  it('jeden slug na firmę z całego katalogu, kursorem przez granice stron (remis published_at)', async () => {
    state.rows = rows(2500).map((row, i) => ({
      ...row,
      companySlug: i % 3 === 0 ? 'firma-x' : i === 5 ? 'firma-y' : undefined,
    }));
    const slugs = await getSitemapCompanySlugs();
    expect([...slugs].sort()).toEqual(['firma-x', 'firma-y']);
    // 2500 ofert po 1000 na stronę = 3 strony (firma-y jest dopiero na trzeciej).
    expect(state.pageCalls).toBe(3);
  });

  it('kontrola ujemna: kursor bez `id` (naiwny) na remisie gubi oferty z dalszych stron', async () => {
    state.naive = true;
    state.rows = rows(2500).map((row, i) => ({ ...row, companySlug: i === 5 ? 'firma-y' : undefined }));
    expect(await getSitemapCompanySlugs()).not.toContain('firma-y');
  });

  it('poza bazą (build) — pusta lista bez zapytań', async () => {
    state.build = true;
    state.rows = rows(10).map((row) => ({ ...row, companySlug: 'firma-x' }));
    expect(await getSitemapCompanySlugs()).toEqual([]);
    expect(state.pageCalls).toBe(0);
  });
});

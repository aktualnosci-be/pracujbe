import { describe, expect, it, vi } from 'vitest';

import { getPublicJobs } from '@/lib/db/public-jobs';
import { maxReachableJobListPage } from '@/lib/job-list-pagination';
import type { TransactionClient, TransactionPool } from '@/lib/db/transaction';

/**
 * #593 — warstwa aplikacji (nie tylko SQL) musi przestać odpytywać `get_public_jobs` dla
 * stron poza granicą offsetu: inaczej różne numery stron mapują się na ten sam, klampowany
 * offset i zwracają zduplikowany wycinek zamiast kolejnych/braku wyników.
 */

function makePool(totalRows: number) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('get_public_jobs_count')) return { rows: [{ total: totalRows }] };
    if (sql.includes('FROM public.get_public_jobs(')) {
      return { rows: [{ job: { id: 'job-1' } }] };
    }
    return { rows: [] };
  });
  const client: TransactionClient = { query, release: vi.fn() };
  const pool: TransactionPool = { connect: vi.fn(async () => client) };
  return { pool, query };
}

function listCalls(query: ReturnType<typeof vi.fn>) {
  return query.mock.calls.filter(([sql]) =>
    String(sql).includes('FROM public.get_public_jobs('),
  ) as Array<[string, unknown[]]>;
}

describe('getPublicJobs — koniec listy poza sufitem offsetu (#593)', () => {
  it('strona z naturalnym offsetem w granicy odpytuje RPC z tym offsetem', async () => {
    const { pool, query } = makePool(1_000_000);
    const result = await getPublicJobs(pool, { locale: 'pl', page: 834, pageSize: 12 });

    const calls = listCalls(query);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[1]?.at(-1)).toBe(9_996); // naturalny offset strony 834 (page-1)*12
    expect(result.rows).toEqual([{ id: 'job-1' }]);
  });

  it('strona TUŻ za granicą wcale nie odpytuje RPC — jawny, pusty koniec listy', async () => {
    const { pool, query } = makePool(1_000_000);
    const result = await getPublicJobs(pool, { locale: 'pl', page: 835, pageSize: 12 });

    expect(listCalls(query)).toHaveLength(0);
    expect(result.rows).toEqual([]);
  });

  it('dwie różne strony poza granicą nie zwracają identycznego, zduplikowanego wycinka', async () => {
    const { pool: poolA, query: queryA } = makePool(1_000_000);
    const { pool: poolB, query: queryB } = makePool(1_000_000);
    const resultA = await getPublicJobs(poolA, { locale: 'pl', page: 900, pageSize: 12 });
    const resultB = await getPublicJobs(poolB, { locale: 'pl', page: 901, pageSize: 12 });

    // Żadna z nich w ogóle nie odpytała RPC (dawny bug: obie odpytałyby offset=10000
    // i wróciłyby z tym samym wycinkiem).
    expect(listCalls(queryA)).toHaveLength(0);
    expect(listCalls(queryB)).toHaveLength(0);
    expect(resultA.rows).toEqual([]);
    expect(resultB.rows).toEqual([]);
  });

  it('`total` zostaje dokładny, tylko `maxPage` jawnie ogranicza zasięg paginacji', async () => {
    const { pool } = makePool(1_000_000);
    const result = await getPublicJobs(pool, { locale: 'pl', page: 1, pageSize: 12 });

    expect(result.total).toBe(1_000_000);
    expect(result.maxPage).toBe(maxReachableJobListPage(12));
    expect(result.maxPage).toBeLessThan(Math.ceil(1_000_000 / 12));
  });

  it('katalog poniżej sufitu: `maxPage` wynika z `total` (małe listy bez zmian)', async () => {
    const { pool } = makePool(25);
    const result = await getPublicJobs(pool, { locale: 'pl', page: 1, pageSize: 12 });
    expect(result.maxPage).toBe(3); // ceil(25/12)
  });

  it('kontrola ujemna: bez strażnika strona poza granicą OD ZAWSZE odpytałaby RPC z klampem', async () => {
    // Odtwarza dokładnie starą (błędną) ścieżkę: brak `isJobListPageBeyondLimit`, offset
    // liczony przez dawny klamp (0026–0110) — dwie różne strony wysyłają IDENTYCZNY offset.
    const legacyOffset = (page: number, pageSize: number) =>
      Math.min(10_000, (page - 1) * pageSize);
    expect(legacyOffset(900, 12)).toBe(legacyOffset(901, 12));
    expect(legacyOffset(900, 12)).toBe(10_000);
  });
});

// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { getPublicJobs, getPublicJobsCount, getPublicJobsPage } from '@/lib/db/public-jobs';
import type { TransactionPool } from '@/lib/db/transaction';

/**
 * PERF-04 (#1230): sekcje bez licznika (strona główna, podobne oferty, pulpit kandydata,
 * partie sitemap) czytają stronę listy BEZ `get_public_jobs_count`, a metadane landingów
 * i liczba partii sitemap — sam licznik, bez wierszy. Atrapa puli zapisuje każde zapytanie.
 */
function recordingPool(rows: unknown[] = [{ job: { slug: 'a' } }]) {
  const sql: string[] = [];
  const pool: TransactionPool = {
    connect: async () => ({
      query: async (text: string) => {
        sql.push(text);
        if (text.includes('get_public_jobs_count')) return { rows: [{ total: 7 }] };
        if (text.includes('get_public_jobs(')) return { rows };
        return { rows: [] };
      },
      release: () => undefined,
    }),
  };
  const calls = (name: string) => sql.filter((text) => text.includes(`public.${name}(`)).length;
  return { pool, calls };
}

describe('lista ofert bez licznika (#1230)', () => {
  it('getPublicJobsPage: tylko get_public_jobs, wynik bez total/maxPage', async () => {
    const { pool, calls } = recordingPool();
    const result = await getPublicJobsPage(pool, { locale: 'pl', page: 2, pageSize: 5 });
    expect(result).toEqual({ rows: [{ slug: 'a' }], page: 2, pageSize: 5 });
    expect(calls('get_public_jobs_count')).toBe(0);
    expect(calls('get_public_jobs')).toBe(1);
  });

  it('getPublicJobsCount: tylko licznik, bez odczytu wierszy', async () => {
    const { pool, calls } = recordingPool();
    expect(await getPublicJobsCount(pool, { locale: 'pl', category: 'warehouse' })).toBe(7);
    expect(calls('get_public_jobs')).toBe(0);
    expect(calls('get_public_jobs_count')).toBe(1);
  });

  it('kontrola ujemna: getPublicJobs (lista z paginacją) nadal liczy total', async () => {
    const { pool, calls } = recordingPool();
    const result = await getPublicJobs(pool, { locale: 'pl' });
    expect(result.total).toBe(7);
    expect(calls('get_public_jobs_count')).toBe(1);
    expect(calls('get_public_jobs')).toBe(1);
  });

  it('strona poza granicą paginacji (#593) nie odpytuje RPC listy także bez licznika', async () => {
    const { pool, calls } = recordingPool();
    expect((await getPublicJobsPage(pool, { locale: 'pl', page: 10_000, pageSize: 100 })).rows).toEqual([]);
    expect(calls('get_public_jobs')).toBe(0);
  });
});

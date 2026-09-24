import { describe, expect, it, vi } from 'vitest';

import { getPublicJobFilterFacets, getPublicJobs } from '@/lib/db/public-jobs';
import type { TransactionClient, TransactionPool } from '@/lib/db/transaction';

describe('dokładne facety publicznych ofert', () => {
  it('wykonuje jeden agregat jako anon i mapuje wszystkie widoczne badge', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('get_public_job_filter_facets'))
        return {
          rows: [
            { dimension: 'total', key: 'all', total: 237 },
            { dimension: 'category', key: 'warehouse', total: 221 },
            { dimension: 'location', key: 'Antwerp', total: 205 },
            { dimension: 'contract', key: 'permanent', total: 219 },
            { dimension: 'accommodation', key: 'provided', total: 88 },
            { dimension: 'accommodation', key: 'unavailable', total: 149 },
            { dimension: 'additional', key: 'immediate', total: 72 },
            { dimension: 'additional', key: 'no_language', total: 41 },
          ],
        };
      return { rows: [] };
    });
    const client: TransactionClient = { query, release: vi.fn() };
    const pool: TransactionPool = { connect: vi.fn(async () => client) };

    await expect(
      getPublicJobFilterFacets(pool, {
        locale: 'pl',
        categories: ['warehouse'],
        contractTypes: ['permanent'],
      }),
    ).resolves.toEqual({
      total: 237,
      categories: { warehouse: 221 },
      locations: [{ city: 'Antwerp', count: 205 }],
      contracts: { permanent: 219 },
      accommodation: { provided: 88, unavailable: 149 },
      immediate: 72,
      noLanguage: 41,
    });
    expect(
      query.mock.calls.filter(([sql]) =>
        String(sql).includes('get_public_job_filter_facets'),
      ),
    ).toHaveLength(1);
    expect(
      query.mock.calls.filter(([sql]) => sql === 'SET LOCAL ROLE anon'),
    ).toHaveLength(1);
  });
});

describe('jednostka wynagrodzenia w publicznych RPC (#188, 0092)', () => {
  const run = async (
    params: Parameters<typeof getPublicJobs>[1],
  ): Promise<Array<[string, unknown[]]>> => {
    const query = vi.fn(async (sql: string, _values?: unknown[]) => {
      if (sql.includes('get_public_jobs_count')) return { rows: [{ total: 0 }] };
      return { rows: [] };
    });
    const client: TransactionClient = { query, release: vi.fn() };
    const pool: TransactionPool = { connect: vi.fn(async () => client) };
    await getPublicJobs(pool, params);
    return query.mock.calls
      .filter(([sql]) => String(sql).includes('get_public_jobs'))
      .map(([sql, values]) => [String(sql), (values ?? []) as unknown[]]);
  };

  it('lista i licznik dostają tę samą jednostkę; sortowanie i stronicowanie po niej', async () => {
    const calls = await run({ locale: 'pl', salaryMin: 18, salaryUnit: 'hour', sort: 'salary' });
    expect(calls).toHaveLength(2);
    for (const [sql, values] of calls) {
      expect(sql).toContain('p_salary_unit => $13::text');
      expect(values[6]).toBe(18);
      expect(values[12]).toBe('hour');
    }
    const [listSql, listValues] = calls.find(([sql]) => sql.includes('p_sort'))!;
    expect(listSql).toContain('p_sort => $14::text');
    expect(listValues.slice(13)).toEqual(['salary', 12, 0]);
  });

  it('bez jednostki = month (zachowanie 0080)', async () => {
    const calls = await run({ locale: 'pl' });
    for (const [, values] of calls) expect(values[12]).toBe('month');
  });
});

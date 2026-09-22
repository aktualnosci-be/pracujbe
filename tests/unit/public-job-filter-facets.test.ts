import { describe, expect, it, vi } from 'vitest';

import { getPublicJobFilterFacets } from '@/lib/db/public-jobs';
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

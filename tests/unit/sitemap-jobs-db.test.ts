import { describe, expect, it } from 'vitest';

import {
  getSitemapJobsPage,
  getSitemapShardStarts,
  parseShardStart,
  parseSitemapJobRow,
} from '@/lib/db/sitemap-jobs';
import type { TransactionPool } from '@/lib/db/transaction';

/**
 * #1042 (0965): warstwa SQL sitemapy ofert — tylko RPC pod anon, kursor jako TEKST z
 * mikrosekundami (nie `Date`), limit strony klampowany, brak konkatenacji wartości do SQL.
 */

function fakePool(respond: (text: string, values?: unknown[]) => unknown) {
  const calls: { text: string; values?: unknown[] }[] = [];
  const pool: TransactionPool = {
    async connect() {
      return {
        async query(text: string, values?: unknown[]) {
          calls.push({ text, values });
          if (/^(BEGIN|COMMIT|ROLLBACK|SET LOCAL|SELECT set_config)/.test(text)) return { rows: [] };
          return respond(text, values);
        },
        release() {},
      };
    },
  };
  return { pool, calls };
}

const CURSOR_TS = '2026-09-01T10:00:00.123456+00:00';
const ID = '11111111-1111-4111-8111-111111111111';

describe('warstwa SQL sitemapy ofert (#1042)', () => {
  it('kursor wraca do bazy jako niezmieniony tekst (mikrosekundy), pod rolą anon', async () => {
    const { pool, calls } = fakePool(() => ({ rows: [] }));
    await getSitemapJobsPage(pool, { publishedAt: CURSOR_TS, id: ID }, { publishedAt: '2026-08-01T00:00:00.000001+00:00', id: ID }, 500);
    expect(calls.some((c) => c.text === 'SET LOCAL ROLE anon')).toBe(true);
    const query = calls.find((c) => c.text.includes('get_public_jobs_sitemap_page'))!;
    expect(query.values).toEqual([CURSOR_TS, ID, '2026-08-01T00:00:00.000001+00:00', ID, 500]);
    expect(query.text).not.toContain(CURSOR_TS);
    expect(query.text).toMatch(/ORDER BY p\.published_at DESC, p\.id DESC/);
  });

  it('brak kursorów = NULL-e; limit klampowany do 1..1000', async () => {
    const { pool, calls } = fakePool(() => ({ rows: [] }));
    await getSitemapJobsPage(pool, null, null, 100_000);
    await getSitemapJobsPage(pool, null, null, 0);
    const values = calls.filter((c) => c.text.includes('get_public_jobs_sitemap_page')).map((c) => c.values);
    expect(values).toEqual([
      [null, null, null, null, 1000],
      [null, null, null, null, 1],
    ]);
  });

  it('granice partii: rozmiar jako parametr, parsowanie wierszy z kursorem i bez', async () => {
    const { pool, calls } = fakePool(() => ({
      rows: [
        { row: { shard_index: 1, after_published_at: null, after_id: null } },
        { row: { shard_index: 2, after_published_at: CURSOR_TS, after_id: ID } },
      ],
    }));
    const starts = await getSitemapShardStarts(pool, 5000);
    expect(starts).toEqual([
      { shardIndex: 1, after: null },
      { shardIndex: 2, after: { publishedAt: CURSOR_TS, id: ID } },
    ]);
    const query = calls.find((c) => c.text.includes('get_public_jobs_sitemap_shard_starts'))!;
    expect(query.values).toEqual([5000]);
  });

  it('wiersz oferty: języki tylko obsługiwane, slug firmy opcjonalny; zły kształt = błąd', () => {
    const row = {
      id: ID,
      slug: 'oferta',
      company_slug: null,
      published_at: CURSOR_TS,
      updated_at: CURSOR_TS,
      locales: ['nl', 'xx', 'pl'],
    };
    expect(parseSitemapJobRow(row)).toEqual({
      id: ID,
      slug: 'oferta',
      publishedAt: CURSOR_TS,
      updatedAt: CURSOR_TS,
      locales: ['nl', 'pl'],
    });
    expect(parseSitemapJobRow({ ...row, company_slug: 'firma' }).companySlug).toBe('firma');
    expect(() => parseSitemapJobRow({ ...row, slug: '' })).toThrow();
    expect(() => parseSitemapJobRow({ ...row, published_at: 'nie-data' })).toThrow();
    expect(() => parseSitemapJobRow({ ...row, locales: null })).toThrow();
    expect(() => parseSitemapJobRow(null)).toThrow();
    expect(() => parseShardStart({ shard_index: 0, after_published_at: null, after_id: null })).toThrow();
    // Połowa kursora (data bez id) to błąd, nie „od początku”.
    expect(() => parseShardStart({ shard_index: 2, after_published_at: CURSOR_TS, after_id: null })).toThrow();
  });
});

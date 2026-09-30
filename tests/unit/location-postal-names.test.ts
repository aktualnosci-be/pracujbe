import { describe, expect, it, vi } from 'vitest';

import { getPublicJobFilterFacets } from '@/lib/db/public-jobs';
import type { TransactionClient, TransactionPool } from '@/lib/db/transaction';
import { cityKey, cityLookupKey } from '@/lib/matching/belgian-cities';

/**
 * #1119 (migracja 0996): miasto oferty z dopiskiem i facet lokalizacji w języku widoku.
 * Zapis `jobs.location_id`, filtry i backfill sprawdza rls.sql sekcja PC1119 (PG16); tu:
 * zgodność klucza TS z SQL i zapytanie facetów aplikacji.
 */

describe('location_lookup_key (SQL) = cityLookupKey (TS)', () => {
  // Te same przypadki co rls.sql PC1119-1 — rozjazd = inna podpowiedź kreatora niż zapis w bazie.
  it.each([
    ['Bruxelles 1000', 'bruxelles'],
    ['1000 Bruxelles', 'bruxelles'],
    ['B-1000 Bruxelles', 'bruxelles'],
    ['BE-1000 Bruxelles', 'bruxelles'],
    ['Leuven (3000)', 'leuven'],
    ['Gent, België', 'gent'],
    ['9000 Gent, Belgium', 'gent'],
    ['Sint-Niklaas', 'sint niklaas'],
    ['1000', ''],
    ['Bruxelles 10000', 'bruxelles 10000'],
    ['Bruxelles 0999', 'bruxelles 0999'],
    ['Bebe 1000', 'bebe'],
  ])('%j → %j', (input, expected) => {
    expect(cityLookupKey(input)).toBe(expected);
  });

  it('kontrola ujemna: pełny klucz (0153) zostawia dopisek i nie trafia w alias miasta', () => {
    expect(cityKey('Bruxelles 1000')).toBe('bruxelles 1000');
    expect(cityKey('B-1000 Bruxelles')).not.toBe('bruxelles');
  });
});

describe('facet lokalizacji w języku widoku', () => {
  function pool(rows: unknown[]) {
    const query = vi.fn(async (sql: string, _values?: unknown[]) =>
      (sql.includes('get_public_job_filter_facets') ? { rows } : { rows: [] }));
    const client: TransactionClient = { query, release: vi.fn() };
    return { query, pool: { connect: vi.fn(async () => client) } as TransactionPool };
  }

  it('nazwa pozycji „miasto” przez location_display_name z językiem strony ($1)', async () => {
    const { query, pool: p } = pool([{ dimension: 'location', key: 'Alost', total: 2 }]);
    const facets = await getPublicJobFilterFacets(p, { locale: 'fr' });
    expect(facets.locations).toEqual([{ city: 'Alost', count: 2 }]);
    const [sql, values] = query.mock.calls.find(([text]) => String(text).includes('get_public_job_filter_facets'))!;
    expect(sql).toContain("WHEN f.dimension = 'location'");
    expect(sql).toContain('public.location_display_name(f.key, $1::text)');
    expect(values?.[0]).toBe('fr');
  });

  it('dwie pozycje o tej samej nazwie w języku widoku = jedna pozycja z sumą', async () => {
    const { pool: p } = pool([
      { dimension: 'location', key: 'Alost', total: 2 },
      { dimension: 'location', key: 'Gent', total: 1 },
      { dimension: 'location', key: 'Alost', total: 3 },
    ]);
    expect((await getPublicJobFilterFacets(p, { locale: 'fr' })).locations).toEqual([
      { city: 'Alost', count: 5 },
      { city: 'Gent', count: 1 },
    ]);
  });
});

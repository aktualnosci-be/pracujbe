import 'server-only';

import type { CategoryKey } from '../jobs';
import { withUserTransaction, type TransactionPool } from './transaction';

export interface PublicCategory {
  key: CategoryKey;
  /** Kanoniczna nazwa awaryjna; tłumaczenia etykiet pozostają w next-intl. */
  name: string;
  icon: string | null;
}

export interface PublicLocation {
  slug: string;
  /** Kanoniczna nazwa awaryjna; nie zastępuje istniejących tłumaczeń miast. */
  name: string;
  region: string | null;
  country: string;
}

/** Brak filtra zwraca aktywny słownik; jawna pusta lista nie wybiera żadnej pozycji. */
export async function getPublicCategories(
  pool: TransactionPool,
  filters: { keys?: readonly string[] } = {},
): Promise<PublicCategory[]> {
  return withUserTransaction(pool, null, async (transaction) => {
    const result = await transaction.query(`SELECT to_jsonb(category) AS category FROM (
      SELECT key::text AS key, name, icon FROM public.categories
      WHERE is_active = true AND ($1::text[] IS NULL OR key::text = ANY($1::text[]))
      ORDER BY sort_order, key
    ) AS category`, [filters.keys ?? null]) as { rows: { category: PublicCategory }[] };
    return result.rows.map(row => row.category);
  });
}

/** Publiczne dane referencyjne; nie odczytuje adresów ani innych danych firm. */
export async function getPublicLocations(
  pool: TransactionPool,
  filters: { slugs?: readonly string[]; country?: string } = {},
): Promise<PublicLocation[]> {
  return withUserTransaction(pool, null, async (transaction) => {
    const result = await transaction.query(`SELECT to_jsonb(location) AS location FROM (
      SELECT slug, name, region, country FROM public.locations
      WHERE is_active = true AND ($1::text[] IS NULL OR slug = ANY($1::text[]))
        AND ($2::text IS NULL OR country = $2::text)
      ORDER BY sort_order, slug
    ) AS location`, [filters.slugs ?? null, filters.country ?? null]) as { rows: { location: PublicLocation }[] };
    return result.rows.map(row => row.location);
  });
}

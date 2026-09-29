import 'server-only';

import { isLocale, type Locale } from '@/i18n/routing';
import {
  withUserTransaction,
  type TransactionPool,
} from './transaction';

/**
 * Odczyt katalogu ofert dla sitemapy (#1042, migracja 0965) — dwa lekkie RPC pod rolą anon,
 * niezależne od `get_public_jobs`: bez licznika, bez OFFSET, stronicowanie kursorem
 * (`published_at desc`, `id desc`). Zapytania mają wyłącznie stałe nazwy funkcji, wartości
 * idą w parametrach.
 *
 * Kursor to para (`publishedAt`, `id`). `publishedAt` jest TEKSTEM ISO z mikrosekundami
 * (`to_jsonb` po stronie SQL) i wraca do bazy bez parsowania do `Date` — obcięcie do
 * milisekund przesunęłoby kursor względem ofert opublikowanych w tej samej milisekundzie
 * (dziury/duble na granicy strony).
 */

export interface SitemapJobCursor {
  publishedAt: string;
  id: string;
}

/** Początek partii sitemap: kursor OSTATNIEJ oferty poprzedniej partii (`null` = od początku). */
export interface SitemapShardStart {
  /** Numer partii od 1 (jak wiersz z bazy). */
  shardIndex: number;
  after: SitemapJobCursor | null;
}

/** Oferta w sitemapie: tylko pola potrzebne do wpisu (adres, alternatywy językowe, lastmod). */
export interface SitemapJobRow {
  id: string;
  slug: string;
  /** Slug profilu zweryfikowanej firmy (0140) albo brak. */
  companySlug?: string;
  publishedAt: string;
  updatedAt: string;
  /** Języki z własnym tłumaczeniem treści (#301), alfabetycznie; pusta lista = brak wpisów. */
  locales: Locale[];
}

/** Największa strona, jaką RPC zwróci (klamp w SQL). */
export const SITEMAP_PAGE_MAX = 1000;

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Nieprawidłowy wiersz sitemapy ofert.');
  }
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('Nieprawidłowe pole tekstowe wiersza sitemapy ofert.');
  }
  return value;
}

function timestamp(value: unknown): string {
  const result = text(value);
  if (Number.isNaN(Date.parse(result))) {
    throw new Error('Nieprawidłowa data wiersza sitemapy ofert.');
  }
  return result;
}

export function parseShardStart(row: unknown): SitemapShardStart {
  const r = record(row);
  const shardIndex = r['shard_index'];
  if (typeof shardIndex !== 'number' || !Number.isSafeInteger(shardIndex) || shardIndex < 1) {
    throw new Error('Nieprawidłowy numer partii sitemapy ofert.');
  }
  const afterPublishedAt = r['after_published_at'];
  const afterId = r['after_id'];
  if (afterPublishedAt == null && afterId == null) return { shardIndex, after: null };
  return { shardIndex, after: { publishedAt: timestamp(afterPublishedAt), id: text(afterId) } };
}

export function parseSitemapJobRow(row: unknown): SitemapJobRow {
  const r = record(row);
  const locales = r['locales'];
  if (!Array.isArray(locales)) throw new Error('Nieprawidłowa lista języków sitemapy ofert.');
  const companySlug = r['company_slug'];
  return {
    id: text(r['id']),
    slug: text(r['slug']),
    ...(typeof companySlug === 'string' && companySlug ? { companySlug } : {}),
    publishedAt: timestamp(r['published_at']),
    updatedAt: timestamp(r['updated_at']),
    locales: locales.filter((value): value is Locale => typeof value === 'string' && isLocale(value)),
  };
}

/**
 * Granice partii sitemap (`shardSize` ofert na partię, 1 wiersz na partię). Pusty wynik = brak
 * publicznych ofert. Liczba partii = długość listy; bez osobnego licznika ofert.
 */
export async function getSitemapShardStarts(
  pool: TransactionPool,
  shardSize: number,
): Promise<SitemapShardStart[]> {
  return withUserTransaction(pool, null, async (transaction) => {
    const result = (await transaction.query(
      `SELECT to_jsonb(s) AS row
       FROM public.get_public_jobs_sitemap_shard_starts($1::integer) AS s
       ORDER BY s.shard_index`,
      [shardSize],
    )) as { rows: { row: unknown }[] };
    return result.rows.map((row) => parseShardStart(row.row));
  });
}

/**
 * Jedna strona ofert kursorem: oferty PO `after` (wyłącznie) aż do `until` (włącznie),
 * najwyżej `limit` (≤ 1000). `after`/`until` = `null` — bez ograniczenia z tej strony.
 */
export async function getSitemapJobsPage(
  pool: TransactionPool,
  after: SitemapJobCursor | null,
  until: SitemapJobCursor | null,
  limit: number,
): Promise<SitemapJobRow[]> {
  return withUserTransaction(pool, null, async (transaction) => {
    const result = (await transaction.query(
      `SELECT to_jsonb(p) AS row
       FROM public.get_public_jobs_sitemap_page(
         $1::timestamptz, $2::uuid, $3::timestamptz, $4::uuid, $5::integer) AS p
       ORDER BY p.published_at DESC, p.id DESC`,
      [
        after?.publishedAt ?? null,
        after?.id ?? null,
        until?.publishedAt ?? null,
        until?.id ?? null,
        Math.min(SITEMAP_PAGE_MAX, Math.max(1, Math.trunc(limit))),
      ],
    )) as { rows: { row: unknown }[] };
    return result.rows.map((row) => parseSitemapJobRow(row.row));
  });
}

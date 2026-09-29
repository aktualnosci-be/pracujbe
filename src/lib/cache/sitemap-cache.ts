import type { MetadataRoute } from 'next';

import { createTtlSingleFlightCache } from '@/lib/cache/ttl-single-flight';

/**
 * Cache wyników sitemap w pamięci procesu (#1042, krok 1). `sitemap.ts` musi zostać
 * `force-dynamic` (build nie czyta bazy, a prerender zamroziłby pustą listę partii — patrz
 * komentarz w pliku i `readiness-postgres-only.test.ts`), więc bez tego każde anonimowe żądanie
 * `/sitemap/<id>.xml` (i `robots.txt`, które liczy listę partii) powtarzało licznik i paginację
 * offsetową ofert na wspólnej puli połączeń. Teraz: okres odświeżania 3600 s + single-flight
 * (równoległe żądania czekają na jedno obliczenie). Błąd odczytu nie jest cache'owany (rzut
 * przechodzi dalej), a wynik zdegradowany (np. nieznane języki tłumaczeń) jest usuwany ze wpisu
 * przez wywołującego (`delete`).
 *
 * Krok 2 (migracja 0965): samo przeliczenie czyta lekkie RPC kursorowe bez licznika i OFFSET
 * (`src/lib/sitemap-jobs.ts`); języki tłumaczeń idą w tym samym zapytaniu, więc wynik
 * „zdegradowany” już nie występuje, a `delete` zostaje ogólną operacją cache.
 */
export const SITEMAP_CACHE_TTL_MS = 3_600_000;

/** Partie sitemap: klucz = id pliku (`0` = core, `1..N` = partie ofert). */
export const sitemapEntriesCache = createTtlSingleFlightCache<MetadataRoute.Sitemap>({
  ttlMs: SITEMAP_CACHE_TTL_MS,
  maxEntries: 64,
});

/** Lista identyfikatorów plików sitemap (`generateSitemaps`, także dla `robots.txt`). */
export const sitemapIdsCache = createTtlSingleFlightCache<{ id: number }[]>({
  ttlMs: SITEMAP_CACHE_TTL_MS,
  maxEntries: 1,
});

/** Tylko do testów: czyści oba cache. */
export function clearSitemapCaches(): void {
  sitemapEntriesCache.clear();
  sitemapIdsCache.clear();
}

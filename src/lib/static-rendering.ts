import { isDatabaseConfigured } from '@/lib/env';

/**
 * Renderowanie statyczne stron publicznych (#298).
 *
 * Strony z ofertami (strona główna, hub `/praca`, landingi kategorii/miast, szczegół oferty)
 * są ISR: `export const revalidate = 60` w pliku strony (Next wymaga literału, więc wartość
 * nie może pochodzić z tej stałej — test `static-rendering.test.ts` pilnuje zgodności).
 *
 * Build nie łączy się z bazą: na Railway sieć prywatna (host bazy) nie jest dostępna podczas
 * builda, a błąd odczytu przerwałby wdrożenie. Gdy baza jest skonfigurowana, `generateStaticParams`
 * zwraca pustą listę — strona powstaje przy pierwszym żądaniu i trafia do cache ISR. Bez bazy
 * (demo, CI, E2E) dane są stałe, więc strony prerenderujemy już w buildzie.
 */
export const PUBLIC_JOBS_REVALIDATE_SECONDS = 60;

export function prerenderParamsAtBuild<T>(params: readonly T[]): T[] {
  return isDatabaseConfigured() ? [] : [...params];
}

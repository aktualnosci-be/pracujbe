/**
 * Tryb zadania retencji w cronie `/api/maintenance` (#574, `run_retention_purge`, 0127).
 *
 * Okresy z opracowania 2026-09-25 są zapisane w `retention_policies`, ale harmonogram włącza
 * właściciel dopiero po akceptacji testów i danych operatora. Do tego czasu zadanie jest
 * WYŁĄCZONE: włącza je wyłącznie jawna zmienna `RETENTION_MODE` o dokładnej wartości:
 *   - `dry-run` — liczniki jednej partii bez zmian danych i bez e-maili (podtransakcja
 *     wycofywana w bazie),
 *   - `apply`   — usuwanie i ostrzeżenia; kolejne partie, dopóki któraś kategoria wyczerpuje
 *     limit (najwyżej `RETENTION_MAX_BATCHES` na przebieg).
 * Brak zmiennej, pusta albo każda inna wartość (literówka, `true`, `APPLY`) = `off`.
 *
 * Kolejka fizycznego usuwania obiektów storage NIE zależy od tego trybu — obsługuje też
 * samoobsługowe usunięcie konta.
 */

export const RETENTION_MODES = ['off', 'dry-run', 'apply'] as const;
export type RetentionMode = (typeof RETENTION_MODES)[number];

/** Rozmiar partii na kategorię (jak w 0105). */
export const RETENTION_BATCH_LIMIT = 200;
/** Najwięcej partii w jednym przebiegu crona (co godzinę) — 2000 rekordów na kategorię. */
export const RETENTION_MAX_BATCHES = 10;

export function retentionMode(value: string | undefined = process.env.RETENTION_MODE): RetentionMode {
  if (value === 'dry-run' || value === 'apply') return value;
  return 'off';
}

/**
 * Sumuje liczniki kolejnych partii. `fullBatches` i `dryRun` nie są sumowane — to stan
 * ostatniej partii (czy zostały zaległości), a nie liczba rekordów.
 */
export function mergeRetentionCounters(
  total: Record<string, number>,
  batch: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = { ...total };
  for (const [key, value] of Object.entries(batch)) {
    if (key === 'fullBatches' || key === 'dryRun') out[key] = value;
    else out[key] = (out[key] ?? 0) + value;
  }
  return out;
}

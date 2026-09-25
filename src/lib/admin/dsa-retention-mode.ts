/**
 * Tryb czyszczenia spraw DSA w cronie `/api/maintenance` (#43, `dsa_retention_run`, 0104).
 *
 * Okres retencji, okno odwołania i termin rozpatrzenia są wartościami tymczasowymi do
 * zatwierdzenia przez właściciela (#40). Do tego czasu zadanie jest WYŁĄCZONE: włącza je
 * wyłącznie jawna zmienna `DSA_RETENTION_MODE` o dokładnej wartości:
 *   - `dry-run` — podgląd bez zmian danych (zapis przebiegu w `dsa_retention_runs`, liczniki),
 *   - `apply`   — anonimizacja spraw po końcu drogi odwołania i okresie retencji.
 * Brak zmiennej, pusta albo każda inna wartość (literówka, `true`, `APPLY`) = `off`.
 */

export const DSA_RETENTION_MODES = ['off', 'dry-run', 'apply'] as const;
export type DsaRetentionMode = (typeof DSA_RETENTION_MODES)[number];

export function dsaRetentionMode(value: string | undefined = process.env.DSA_RETENTION_MODE): DsaRetentionMode {
  if (value === 'dry-run' || value === 'apply') return value;
  return 'off';
}


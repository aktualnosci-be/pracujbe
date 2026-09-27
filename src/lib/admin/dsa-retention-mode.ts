/**
 * Tryb czyszczenia spraw DSA w cronie `/api/maintenance` (#43, `dsa_retention_run`, 0104).
 *
 * Okres retencji (12 miesięcy), okno odwołania (6 miesięcy) i termin rozpatrzenia (14 dni)
 * zatwierdził właściciel 26.09.2026 (#40; strażnik `tests/unit/dsa-approved-terms.test.ts`).
 * Zadanie włącza wyłącznie jawna zmienna `DSA_RETENTION_MODE` o dokładnej wartości
 * (na produkcji ustawione `dry-run`; działa dopiero z cronem `/api/maintenance`):
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


import { z } from 'zod/v3';

/**
 * Zgodność wdrożonego schematu bazy z wdrożonym kodem (#1065, audyt OPS14-02).
 *
 * Railway wdraża `main` automatycznie, a migracje SQL nakłada osobny krok operatora
 * (`docs/railway/WDROZENIE_MIGRACJI.md`). W oknie między wdrożeniem kodu a migracją przepływy
 * używające nowych funkcji bazy kończą się ogólnym `INTERNAL`, którego monitoring nie odróżniał od
 * innych awarii. Build zapisuje nazwę najwyższej migracji, jaką zna (`PRACUJBE_EXPECTED_MIGRATION`,
 * `scripts/db/expected-migration.mjs` → `next.config.mjs`), a `public.ops_schema_state()` (0964)
 * zwraca najwyższą zastosowaną. Baza ZA kodem = alarm `schema_behind_code`; baza przed kodem
 * (rollback wdrożenia, migracje są addytywne) nie jest alarmem.
 *
 * Moduł czysty (bez I/O) — testowany jednostkowo z kontrolami ujemnymi; odczyt bazy w `metrics-source.ts`.
 */

export type SchemaSignal = 'schema_behind_code' | 'schema_state_unreadable';

const schemaStateSchema = z.object({
  applied: z.number().int().nonnegative(),
  latest: z.string().nullable(),
});

/** Stan historii migracji zwracany przez `ops_schema_state()`. */
export type SchemaState = z.infer<typeof schemaStateSchema>;

export function parseSchemaState(raw: unknown): SchemaState | null {
  const parsed = schemaStateSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Wynik odczytu: stan, brak funkcji (baza sprzed 0964), brak źródła albo błąd odczytu. */
export type SchemaStateResult =
  | { kind: 'ok'; state: SchemaState }
  | { kind: 'missing' }
  | { kind: 'unconfigured' }
  | { kind: 'error' };

/** Nazwa najwyższej migracji znanej buildowi; brak/pusta wartość = czujka wyłączona. */
export function expectedMigrationFromEnv(env: Record<string, string | undefined> = process.env): string | null {
  const value = env.PRACUJBE_EXPECTED_MIGRATION?.trim();
  return value && /^\d{4}_[a-z0-9_]+\.sql$/.test(value) ? value : null;
}

/** Porządek migracji = numer z nazwy (`NNNN_…`); nazwy wcześniej sprawdzone wzorcem. */
export function isMigrationBehind(applied: string | null, expected: string): boolean {
  if (!applied) return true;
  return applied.slice(0, 4) < expected.slice(0, 4);
}

/**
 * @param expected nazwa z builda; `null` = build bez informacji o migracjach (nic nie porównujemy).
 */
export function schemaAlerts(expected: string | null, result: SchemaStateResult): SchemaSignal[] {
  if (!expected) return [];
  switch (result.kind) {
    case 'ok':
      return isMigrationBehind(result.state.latest, expected) ? ['schema_behind_code'] : [];
    // Funkcja pojawia się razem z migracją 0964 — jej brak to baza sprzed niej, czyli za kodem.
    case 'missing':
      return ['schema_behind_code'];
    // Bez źródła metryk `/api/health/ops` i tak odpowiada `unconfigured` (503) wcześniej.
    case 'unconfigured':
      return [];
    case 'error':
      return ['schema_state_unreadable'];
  }
}

/** Opis w odpowiedzi czujek: nazwy migracji i liczba zastosowanych (bez konfiguracji i adresów). */
export function schemaSummary(
  expected: string | null,
  result: SchemaStateResult,
): { expected: string | null; latest: string | null; applied: number | null; status: 'ok' | 'behind' | 'unreadable' | 'skipped' } {
  const alerts = schemaAlerts(expected, result);
  const state = result.kind === 'ok' ? result.state : null;
  const status = !expected || result.kind === 'unconfigured'
    ? 'skipped'
    : alerts.includes('schema_state_unreadable')
      ? 'unreadable'
      : alerts.includes('schema_behind_code')
        ? 'behind'
        : 'ok';
  return { expected, latest: state?.latest ?? null, applied: state?.applied ?? null, status };
}

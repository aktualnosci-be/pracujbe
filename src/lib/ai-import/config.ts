import 'server-only';

import { isProductionMode } from '@/lib/env';

/**
 * Konfiguracja importu ogłoszenia przez AI (#465). Czytana leniwie, wyłącznie na serwerze —
 * klucz API nigdy nie trafia do bundla przeglądarki.
 *
 * Funkcja jest WIDOCZNA tylko gdy:
 *   - `AI_JOB_IMPORT_ENABLED` = `1`/`true` (domyślnie wyłączona, także w produkcji), ORAZ
 *   - jest dostawca: `ANTHROPIC_API_KEY` albo — tylko poza trybem produkcyjnym — atrapa
 *     `AI_JOB_IMPORT_PROVIDER=fixture` (E2E i lokalny UX bez kosztów i bez sieci).
 *
 * Tryb produkcyjny (`APP_MODE=production`) nigdy nie używa atrapy: bez klucza funkcja jest
 * ukryta, a reszta kreatora działa bez zmian.
 */

/** Domyślny model: najnowszy Claude Opus z vision i structured output (docs/AI_JOB_IMPORT.md). */
export const DEFAULT_JOB_IMPORT_MODEL = 'claude-opus-5';

export type JobImportProvider = 'anthropic' | 'fixture';

function flagOn(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true';
}

/** Dostawca ekstrakcji albo `null`, gdy funkcja jest wyłączona/nieskonfigurowana. */
export function jobImportProvider(): JobImportProvider | null {
  if (!flagOn(process.env.AI_JOB_IMPORT_ENABLED)) return null;
  if (process.env.AI_JOB_IMPORT_PROVIDER === 'fixture') {
    return isProductionMode() ? null : 'fixture';
  }
  return process.env.ANTHROPIC_API_KEY ? 'anthropic' : null;
}

/** Czy krok „Zaimportuj z ogłoszenia” ma być widoczny w kreatorze. */
export function isJobImportEnabled(): boolean {
  return jobImportProvider() !== null;
}

/** Model Claude (nadpisywalny przez `AI_JOB_IMPORT_MODEL`, np. tańszy `claude-sonnet-5`). */
export function jobImportModel(): string {
  const m = process.env.AI_JOB_IMPORT_MODEL?.trim();
  return m && /^[a-z0-9][a-z0-9.-]{2,63}$/.test(m) ? m : DEFAULT_JOB_IMPORT_MODEL;
}

import 'server-only';

import { DEFAULT_AI_MODEL, isOpenAiConfigured, resolveAiModel } from '@/lib/ai/model-config';
import { isProductionMode } from '@/lib/env';

/**
 * Konfiguracja importu ogłoszenia przez AI (#465). Czytana leniwie, wyłącznie na serwerze —
 * klucz API nigdy nie trafia do bundla przeglądarki.
 *
 * Funkcja jest WIDOCZNA tylko gdy:
 *   - `AI_JOB_IMPORT_ENABLED` = `1`/`true` (domyślnie wyłączona, także w produkcji), ORAZ
 *   - jest dostawca: `OPENAI_API_KEY` albo — tylko poza trybem produkcyjnym — atrapa
 *     `AI_JOB_IMPORT_PROVIDER=fixture` (E2E i lokalny UX bez kosztów i bez sieci).
 *
 * Tryb produkcyjny (`APP_MODE=production`) nigdy nie używa atrapy: bez klucza funkcja jest
 * ukryta, a reszta kreatora działa bez zmian.
 */

/** Domyślny model: GPT-6 Luna (decyzja właściciela 2026-09-26, `src/lib/ai/openai.ts`). */
export const DEFAULT_JOB_IMPORT_MODEL = DEFAULT_AI_MODEL;

export type JobImportProvider = 'openai' | 'fixture';

function flagOn(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true';
}

/** Dostawca ekstrakcji albo `null`, gdy funkcja jest wyłączona/nieskonfigurowana. */
export function jobImportProvider(): JobImportProvider | null {
  if (!flagOn(process.env.AI_JOB_IMPORT_ENABLED)) return null;
  if (process.env.AI_JOB_IMPORT_PROVIDER === 'fixture') {
    return isProductionMode() ? null : 'fixture';
  }
  return isOpenAiConfigured() ? 'openai' : null;
}

/** Czy krok „Zaimportuj z ogłoszenia” ma być widoczny w kreatorze. */
export function isJobImportEnabled(): boolean {
  return jobImportProvider() !== null;
}

/** Model OpenAI: `AI_JOB_IMPORT_MODEL` → `AI_MODEL` → `gpt-6-luna` (`resolveAiModel`). */
export function jobImportModel(): string {
  return resolveAiModel(process.env.AI_JOB_IMPORT_MODEL);
}

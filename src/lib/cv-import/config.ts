import 'server-only';

import { DEFAULT_JOB_IMPORT_MODEL } from '@/lib/ai-import/config';
import { isProductionMode } from '@/lib/env';

/**
 * Konfiguracja importu CV przez AI (#487, #498). Czytana leniwie, wyłącznie na serwerze —
 * klucz API nigdy nie trafia do bundla przeglądarki. Zasady jak przy imporcie ogłoszeń
 * (`src/lib/ai-import/config.ts`), ale z OSOBNĄ flagą: włączenie importu ogłoszeń nie
 * włącza odczytu CV (osobna bramka prawna — `docs/AI_CV_IMPORT.md`).
 *
 * Funkcja jest WIDOCZNA tylko gdy:
 *   - `AI_CV_IMPORT_ENABLED` = `1`/`true` (domyślnie wyłączona, także w produkcji), ORAZ
 *   - jest dostawca: `ANTHROPIC_API_KEY` albo — tylko poza trybem produkcyjnym — atrapa
 *     `AI_CV_IMPORT_PROVIDER=fixture` (E2E i lokalny UX bez kosztów i bez sieci).
 */

export type CvImportProvider = 'anthropic' | 'fixture';

function flagOn(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true';
}

/** Dostawca ekstrakcji albo `null`, gdy funkcja jest wyłączona/nieskonfigurowana. */
export function cvImportProvider(): CvImportProvider | null {
  if (!flagOn(process.env.AI_CV_IMPORT_ENABLED)) return null;
  if (process.env.AI_CV_IMPORT_PROVIDER === 'fixture') {
    return isProductionMode() ? null : 'fixture';
  }
  return process.env.ANTHROPIC_API_KEY ? 'anthropic' : null;
}

/** Czy import CV ma być widoczny w panelu kandydata. */
export function isCvImportEnabled(): boolean {
  return cvImportProvider() !== null;
}

/** Model Claude (nadpisywalny przez `AI_CV_IMPORT_MODEL`); domyślnie ten sam co import ogłoszeń. */
export function cvImportModel(): string {
  const m = process.env.AI_CV_IMPORT_MODEL?.trim();
  return m && /^[a-z0-9][a-z0-9.-]{2,63}$/.test(m) ? m : DEFAULT_JOB_IMPORT_MODEL;
}

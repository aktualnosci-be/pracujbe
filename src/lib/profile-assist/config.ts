import 'server-only';

import { DEFAULT_JOB_IMPORT_MODEL } from '@/lib/ai-import/config';
import { isProductionMode } from '@/lib/env';

/**
 * Konfiguracja asystenta budowania profilu kandydata (#37, część kandydata). Czytana leniwie,
 * wyłącznie na serwerze. Osobna flaga — włączenie importu CV (#487) ani asystenta ofert
 * nie włącza tej funkcji (`docs/AI_PROFILE_ASSIST.md`).
 *
 * Funkcja jest WIDOCZNA tylko gdy:
 *   - `AI_PROFILE_ASSIST_ENABLED` = `1`/`true` (domyślnie wyłączona, także w produkcji), ORAZ
 *   - jest dostawca: `ANTHROPIC_API_KEY` albo — tylko poza trybem produkcyjnym — atrapa
 *     `AI_PROFILE_ASSIST_PROVIDER=fixture` (E2E i lokalny UX bez kosztów i bez sieci).
 */

export type ProfileAssistProvider = 'anthropic' | 'fixture';

function flagOn(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true';
}

export function profileAssistProvider(): ProfileAssistProvider | null {
  if (!flagOn(process.env.AI_PROFILE_ASSIST_ENABLED)) return null;
  if (process.env.AI_PROFILE_ASSIST_PROVIDER === 'fixture') {
    return isProductionMode() ? null : 'fixture';
  }
  return process.env.ANTHROPIC_API_KEY ? 'anthropic' : null;
}

export function isProfileAssistEnabled(): boolean {
  return profileAssistProvider() !== null;
}

/** Model Claude (nadpisywalny przez `AI_PROFILE_ASSIST_MODEL`); domyślnie jak import CV. */
export function profileAssistModel(): string {
  const m = process.env.AI_PROFILE_ASSIST_MODEL?.trim();
  return m && /^[a-z0-9][a-z0-9.-]{2,63}$/.test(m) ? m : DEFAULT_JOB_IMPORT_MODEL;
}

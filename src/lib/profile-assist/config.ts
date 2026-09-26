import 'server-only';

import { isOpenAiConfigured, resolveAiModel } from '@/lib/ai/model-config';
import { isProductionMode } from '@/lib/env';

/**
 * Konfiguracja asystenta budowania profilu kandydata (#37, część kandydata). Czytana leniwie,
 * wyłącznie na serwerze. Osobna flaga — włączenie importu CV (#487) ani asystenta ofert
 * nie włącza tej funkcji (`docs/AI_PROFILE_ASSIST.md`).
 *
 * Funkcja jest WIDOCZNA tylko gdy:
 *   - `AI_PROFILE_ASSIST_ENABLED` = `1`/`true` (domyślnie wyłączona, także w produkcji), ORAZ
 *   - jest dostawca: `OPENAI_API_KEY` albo — tylko poza trybem produkcyjnym — atrapa
 *     `AI_PROFILE_ASSIST_PROVIDER=fixture` (E2E i lokalny UX bez kosztów i bez sieci).
 */

export type ProfileAssistProvider = 'openai' | 'fixture';

function flagOn(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true';
}

export function profileAssistProvider(): ProfileAssistProvider | null {
  if (!flagOn(process.env.AI_PROFILE_ASSIST_ENABLED)) return null;
  if (process.env.AI_PROFILE_ASSIST_PROVIDER === 'fixture') {
    return isProductionMode() ? null : 'fixture';
  }
  return isOpenAiConfigured() ? 'openai' : null;
}

export function isProfileAssistEnabled(): boolean {
  return profileAssistProvider() !== null;
}

/** Model OpenAI: `AI_PROFILE_ASSIST_MODEL` → `AI_MODEL` → `gpt-6-luna` (`resolveAiModel`). */
export function profileAssistModel(): string {
  return resolveAiModel(process.env.AI_PROFILE_ASSIST_MODEL);
}

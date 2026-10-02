import 'server-only';

import { isAiFeatureEnabled } from '@/lib/ai/feature-gate';
import { isOpenAiConfigured, resolveAiModel } from '@/lib/ai/model-config';
import { isProductionMode } from '@/lib/env';

/**
 * Konfiguracja wyszukiwania opisem (#711). Wzór: asystent treści oferty (#37). Czytana leniwie,
 * wyłącznie na serwerze. Funkcja jest WIDOCZNA tylko gdy:
 *   - `AI_JOB_SEARCH_ENABLED` = `1`/`true` (domyślnie wyłączona, także w produkcji), ORAZ
 *   - jest dostawca: `OPENAI_API_KEY` albo — tylko poza trybem produkcyjnym — atrapa
 *     `AI_JOB_SEARCH_PROVIDER=fixture` (E2E i lokalny UX bez kosztów i bez sieci).
 */

export type JobSearchAssistProvider = 'openai' | 'fixture';

export function jobSearchAssistProvider(): JobSearchAssistProvider | null {
  // Flaga funkcji × tryb produktu (wspólna bramka `src/lib/ai/feature-gate.ts`).
  if (!isAiFeatureEnabled('job_search_filters')) return null;
  if (process.env.AI_JOB_SEARCH_PROVIDER === 'fixture') {
    return isProductionMode() ? null : 'fixture';
  }
  return isOpenAiConfigured() ? 'openai' : null;
}

export function isJobSearchAssistEnabled(): boolean {
  return jobSearchAssistProvider() !== null;
}

/** Model OpenAI: `AI_JOB_SEARCH_MODEL` → `AI_MODEL` → `gpt-6-luna` (`resolveAiModel`). */
export function jobSearchAssistModel(): string {
  return resolveAiModel(process.env.AI_JOB_SEARCH_MODEL);
}

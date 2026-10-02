import 'server-only';

import { isAiFeatureEnabled } from '@/lib/ai/feature-gate';
import { isOpenAiConfigured, resolveAiModel } from '@/lib/ai/model-config';
import { isProductionMode } from '@/lib/env';

/**
 * Konfiguracja „Wyjaśnij ofertę” (#773). Wzór: asystent redagowania (`src/lib/ai-assist/config.ts`).
 * Czytana leniwie, wyłącznie na serwerze.
 *
 * Funkcja jest WIDOCZNA tylko gdy:
 *   - `AI_JOB_EXPLAIN_ENABLED` = `1`/`true` (domyślnie wyłączona, także w produkcji) i tryb
 *     produktu ją dopuszcza (wspólna bramka `isAiFeatureEnabled` — wejście to wyłącznie treść
 *     ogłoszenia, więc działa w trybie ogłoszeniowym), ORAZ
 *   - jest dostawca: `OPENAI_API_KEY` albo — tylko poza trybem produkcyjnym — atrapa
 *     `AI_JOB_EXPLAIN_PROVIDER=fixture` (E2E i lokalny UX bez kosztów i bez sieci).
 */

export type JobExplainProvider = 'openai' | 'fixture';

export function jobExplainProvider(): JobExplainProvider | null {
  if (!isAiFeatureEnabled('job_offer_explain')) return null;
  if (process.env.AI_JOB_EXPLAIN_PROVIDER === 'fixture') {
    return isProductionMode() ? null : 'fixture';
  }
  return isOpenAiConfigured() ? 'openai' : null;
}

export function isJobExplainEnabled(): boolean {
  return jobExplainProvider() !== null;
}

/** Model OpenAI: `AI_JOB_EXPLAIN_MODEL` → `AI_MODEL` → `gpt-6-luna` (`resolveAiModel`). */
export function jobExplainModel(): string {
  return resolveAiModel(process.env.AI_JOB_EXPLAIN_MODEL);
}

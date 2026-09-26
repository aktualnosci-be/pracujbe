import 'server-only';

import { DEFAULT_AI_MODEL, isOpenAiConfigured, resolveAiModel } from '@/lib/ai/model-config';
import { isProductionMode } from '@/lib/env';

/**
 * Konfiguracja asystenta redagowania oferty (#37, część pracodawcy). Wzór: import ogłoszenia
 * (#465, `src/lib/ai-import/config.ts`). Czytana leniwie, wyłącznie na serwerze.
 *
 * Asystent jest WIDOCZNY tylko gdy:
 *   - `AI_JOB_ASSIST_ENABLED` = `1`/`true` (domyślnie wyłączony, także w produkcji), ORAZ
 *   - jest dostawca: `OPENAI_API_KEY` albo — tylko poza trybem produkcyjnym — atrapa
 *     `AI_JOB_ASSIST_PROVIDER=fixture` (E2E i lokalny UX bez kosztów i bez sieci).
 */

/** Domyślny model: GPT-6 Luna (decyzja właściciela 2026-09-26, `src/lib/ai/openai.ts`). */
export const DEFAULT_JOB_ASSIST_MODEL = DEFAULT_AI_MODEL;

export type JobAssistProvider = 'openai' | 'fixture';

function flagOn(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true';
}

/** Dostawca albo `null`, gdy asystent jest wyłączony/nieskonfigurowany. */
export function jobAssistProvider(): JobAssistProvider | null {
  if (!flagOn(process.env.AI_JOB_ASSIST_ENABLED)) return null;
  if (process.env.AI_JOB_ASSIST_PROVIDER === 'fixture') {
    return isProductionMode() ? null : 'fixture';
  }
  return isOpenAiConfigured() ? 'openai' : null;
}

/** Czy panel asystenta ma być widoczny w kreatorze. */
export function isJobAssistEnabled(): boolean {
  return jobAssistProvider() !== null;
}

/** Model OpenAI: `AI_JOB_ASSIST_MODEL` → `AI_MODEL` → `gpt-6-luna` (`resolveAiModel`). */
export function jobAssistModel(): string {
  return resolveAiModel(process.env.AI_JOB_ASSIST_MODEL);
}

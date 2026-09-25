import 'server-only';

import { isProductionMode } from '@/lib/env';

/**
 * Konfiguracja asystenta redagowania oferty (#37, część pracodawcy). Wzór: import ogłoszenia
 * (#465, `src/lib/ai-import/config.ts`). Czytana leniwie, wyłącznie na serwerze.
 *
 * Asystent jest WIDOCZNY tylko gdy:
 *   - `AI_JOB_ASSIST_ENABLED` = `1`/`true` (domyślnie wyłączony, także w produkcji), ORAZ
 *   - jest dostawca: `ANTHROPIC_API_KEY` albo — tylko poza trybem produkcyjnym — atrapa
 *     `AI_JOB_ASSIST_PROVIDER=fixture` (E2E i lokalny UX bez kosztów i bez sieci).
 */

/** Domyślny model: aktualny najnowszy Claude (docs/AI_JOB_ASSIST.md). */
export const DEFAULT_JOB_ASSIST_MODEL = 'claude-opus-5-5';

export type JobAssistProvider = 'anthropic' | 'fixture';

function flagOn(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true';
}

/** Dostawca albo `null`, gdy asystent jest wyłączony/nieskonfigurowany. */
export function jobAssistProvider(): JobAssistProvider | null {
  if (!flagOn(process.env.AI_JOB_ASSIST_ENABLED)) return null;
  if (process.env.AI_JOB_ASSIST_PROVIDER === 'fixture') {
    return isProductionMode() ? null : 'fixture';
  }
  return process.env.ANTHROPIC_API_KEY ? 'anthropic' : null;
}

/** Czy panel asystenta ma być widoczny w kreatorze. */
export function isJobAssistEnabled(): boolean {
  return jobAssistProvider() !== null;
}

/** Model Claude (nadpisywalny przez `AI_JOB_ASSIST_MODEL`). */
export function jobAssistModel(): string {
  const m = process.env.AI_JOB_ASSIST_MODEL?.trim();
  return m && /^[a-z0-9][a-z0-9.-]{2,63}$/.test(m) ? m : DEFAULT_JOB_ASSIST_MODEL;
}

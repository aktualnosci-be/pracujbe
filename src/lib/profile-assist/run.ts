import 'server-only';

import { AiBudgetError } from '@/lib/ai/budget-error';
import { ExtractorError } from '@/lib/ai-import/extract';
import type { CvRedactionCounts } from '@/lib/cv-import/minimize';
import { mapCvExtraction } from '@/lib/cv-import/proposals';
import type { CvProposal } from '@/lib/cv-import/types';
import type { ErrorCode } from '@/lib/errors';
import type { ProfileAssistor } from '@/lib/profile-assist/extract';
import { prepareProfileAnswers } from '@/lib/profile-assist/prepare';
import { profileAnswersSchema } from '@/lib/profile-assist/questions';

/**
 * Rdzeń asystenta profilu (#37) bez autoryzacji i zapisu — te robi akcja serwerowa.
 * Odpowiedzi → przygotowanie (`prepareProfileAnswers`) → model → walidacja
 * (`mapCvExtraction`, ta sama co import CV). Nic nie jest zapisywane.
 */

export type ProposeFromAnswersResult =
  | { ok: true; proposals: CvProposal[]; suspicious: boolean; removed: CvRedactionCounts }
  | { ok: false; error: ErrorCode };

/** Wynik przygotowania bez wywołania modelu (kody użytkowe). */
export function checkProfileAnswers(input: unknown) {
  const parsed = profileAnswersSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'VALIDATION_FAILED' as ErrorCode };
  const prepared = prepareProfileAnswers(parsed.data);
  if (!prepared.ok) {
    const error: ErrorCode =
      prepared.reason === 'identifier'
        ? 'PROFILE_ASSIST_SENSITIVE_DATA'
        : prepared.reason === 'uncertain'
          ? 'PROFILE_ASSIST_UNCERTAIN'
          : prepared.reason === 'suspicious'
            ? 'PROFILE_ASSIST_SUSPICIOUS'
            : 'PROFILE_ASSIST_EMPTY';
    return { ok: false as const, error };
  }
  return prepared;
}

export async function proposeFromAnswers(input: unknown, assistor: ProfileAssistor): Promise<ProposeFromAnswersResult> {
  const prepared = checkProfileAnswers(input);
  if (!prepared.ok) return prepared;

  let raw: unknown;
  try {
    raw = await assistor.extract(prepared.text);
  } catch (e) {
    // #36: budżet przekroczony lub niedostępny — model nie został wywołany (fail-closed).
    if (e instanceof AiBudgetError) return { ok: false, error: 'AI_BUDGET_EXCEEDED' };
    if (e instanceof ExtractorError && e.reason === 'rateLimited') return { ok: false, error: 'RATE_LIMITED' };
    return { ok: false, error: 'PROFILE_ASSIST_FAILED' };
  }

  // `aboutWork` pełni rolę `isCv` z importu CV — reszta walidacji identyczna.
  const aboutWork = typeof raw === 'object' && raw !== null && (raw as { aboutWork?: unknown }).aboutWork === true;
  const mapped = mapCvExtraction(typeof raw === 'object' && raw !== null ? { ...raw, isCv: aboutWork } : raw, prepared.text);
  if (mapped.sensitiveIdentifier) return { ok: false, error: 'PROFILE_ASSIST_SENSITIVE_DATA' };
  if (mapped.suspicious) return { ok: false, error: 'PROFILE_ASSIST_SUSPICIOUS' };
  if (!mapped.isCv) return { ok: false, error: 'PROFILE_ASSIST_NOT_ABOUT_WORK' };
  if (mapped.proposals.length === 0) return { ok: false, error: 'PROFILE_ASSIST_NO_PROPOSALS' };
  return { ok: true, proposals: mapped.proposals, suspicious: false, removed: prepared.removed };
}

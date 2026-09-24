/**
 * Reguły odwołań od decyzji moderacyjnych (DSA, #43) — wspólne dla formularzy (przeglądarka)
 * i Server Actions. Te same limity egzekwuje baza (RPC `submit_moderation_appeal`,
 * `submit_report_appeal`, `admin_decide_appeal`, CHECK-i `moderation_appeals`, migracja 0103).
 */

import {
  isModerationGround,
  MODERATION_GROUND_REFERENCE_MAX,
  MODERATION_GROUND_REFERENCE_MIN,
  type ModerationFieldError,
} from '@/lib/admin/moderation';

export const APPEAL_GROUNDS_MIN = 20;
export const APPEAL_GROUNDS_MAX = 2000;
export const APPEAL_REASONING_MIN = 20;
export const APPEAL_REASONING_MAX = 1000;

/** Kto się odwołuje: autor treści (od ograniczenia) albo zgłaszający (od braku działań). */
export const APPEAL_ROLES = ['author', 'reporter'] as const;
export type AppealRole = (typeof APPEAL_ROLES)[number];

export const APPEAL_STATUSES = ['pending', 'upheld', 'reversed'] as const;
export type AppealStatus = (typeof APPEAL_STATUSES)[number];

export const APPEAL_OUTCOMES = ['upheld', 'reversed'] as const;
export type AppealOutcome = (typeof APPEAL_OUTCOMES)[number];

/**
 * Stan drogi odwołania od decyzji (`moderation_appealable`, 0103): `OK` — można się odwołać;
 * pozostałe — nie (już złożone, termin upłynął, ograniczenie cofnięte / decyzja zmieniona).
 */
export const APPEAL_STATES = ['OK', 'APPEAL_EXISTS', 'APPEAL_WINDOW_CLOSED', 'INVALID_TRANSITION', 'NOT_FOUND'] as const;
export type AppealState = (typeof APPEAL_STATES)[number];

/** Rozstrzygnięcia ponownie stosujące skutek po odwołaniu zgłaszającego — wg celu zgłoszenia. */
export function appealRestrictionsForTarget(targetType: string): Array<'job_removed' | 'company_suspended'> {
  return targetType === 'job' ? ['job_removed', 'company_suspended'] : ['company_suspended'];
}

function oneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value);
}

export function isAppealStatus(value: unknown): value is AppealStatus {
  return oneOf(APPEAL_STATUSES, value);
}

export function isAppealRole(value: unknown): value is AppealRole {
  return oneOf(APPEAL_ROLES, value);
}

export function parseAppealState(value: unknown): AppealState | null {
  return oneOf(APPEAL_STATES, value) ? value : null;
}

function lengthError(value: string | null | undefined, min: number, max: number): ModerationFieldError | null {
  const trimmed = (value ?? '').trim();
  if (trimmed.length === 0) return 'required';
  if (trimmed.length < min) return 'tooShort';
  if (trimmed.length > max) return 'tooLong';
  return null;
}

/** Błąd uzasadnienia odwołania albo null. */
export function appealGroundsError(grounds: string | null | undefined): ModerationFieldError | null {
  return lengthError(grounds, APPEAL_GROUNDS_MIN, APPEAL_GROUNDS_MAX);
}

export type AppealDecisionField = 'outcome' | 'reasoning' | 'decision' | 'groundType' | 'groundReference';

export interface AppealDecisionInput {
  outcome: string;
  reasoning: string;
  /** Tylko uwzględnienie odwołania zgłaszającego: nowe ograniczenie treści. */
  decision?: string | null;
  groundType?: string | null;
  groundReference?: string | null;
}

/** Uwzględnienie odwołania zgłaszającego wymaga nowej decyzji ograniczającej z podstawą. */
export function appealNeedsRestriction(role: string, outcome: string): boolean {
  return role === 'reporter' && outcome === 'reversed';
}

/** Pierwszy błąd pola rozpatrzenia (kolejność jak w formularzu) albo null. */
export function appealDecisionError(
  input: AppealDecisionInput,
  role: string,
  targetType: string,
): { field: AppealDecisionField; error: ModerationFieldError } | null {
  if (!oneOf(APPEAL_OUTCOMES, input.outcome)) return { field: 'outcome', error: 'required' };
  const reasoning = lengthError(input.reasoning, APPEAL_REASONING_MIN, APPEAL_REASONING_MAX);
  if (reasoning) return { field: 'reasoning', error: reasoning };
  if (appealNeedsRestriction(role, input.outcome)) {
    const decision = input.decision ?? '';
    if (!decision) return { field: 'decision', error: 'required' };
    if (!(appealRestrictionsForTarget(targetType) as string[]).includes(decision)) {
      return { field: 'decision', error: 'scope' };
    }
    if (!isModerationGround(input.groundType)) return { field: 'groundType', error: 'required' };
    const reference = lengthError(
      input.groundReference,
      MODERATION_GROUND_REFERENCE_MIN,
      MODERATION_GROUND_REFERENCE_MAX,
    );
    if (reference) return { field: 'groundReference', error: reference };
  }
  return null;
}

/** Mapuje komunikat `VALIDATION_FAILED: …` z RPC odwołań na błąd pola (gdy da się je wskazać). */
export function appealFieldFromDbMessage(
  message: string,
): { field: AppealDecisionField | 'grounds'; error: ModerationFieldError } | null {
  if (message.includes('GROUNDS_REQUIRED')) return { field: 'grounds', error: 'tooShort' };
  if (message.includes('GROUNDS_TOO_LONG')) return { field: 'grounds', error: 'tooLong' };
  if (message.includes('REASONING_REQUIRED')) return { field: 'reasoning', error: 'tooShort' };
  if (message.includes('REASONING_TOO_LONG')) return { field: 'reasoning', error: 'tooLong' };
  if (message.includes('GROUND_REFERENCE_REQUIRED')) return { field: 'groundReference', error: 'required' };
  if (message.includes('GROUND_REFERENCE_TOO_LONG')) return { field: 'groundReference', error: 'tooLong' };
  if (message.includes('GROUND_REQUIRED')) return { field: 'groundType', error: 'required' };
  if (message.includes('DECISION_SCOPE')) return { field: 'decision', error: 'scope' };
  if (message.includes('VALIDATION_FAILED: DECISION')) return { field: 'decision', error: 'required' };
  if (message.includes('VALIDATION_FAILED: OUTCOME')) return { field: 'outcome', error: 'required' };
  return null;
}

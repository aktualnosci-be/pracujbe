/**
 * Reguły decyzji moderacyjnej w sprawie DSA (#42) — wspólne dla dialogu (przeglądarka)
 * i Server Action. Te same limity i zasady egzekwuje baza (RPC `admin_decide_report` /
 * `admin_restore_moderation`, CHECK-i `moderation_decisions`, migracja 0095).
 */

/** Rodzaje decyzji: brak działań albo ograniczenie treści (zasięg: oferta / firma). */
export const MODERATION_DECISIONS = ['no_action', 'job_removed', 'company_suspended'] as const;
export type ModerationDecision = (typeof MODERATION_DECISIONS)[number];

/** Podstawa ograniczenia: regulamin serwisu albo przepis prawa. */
export const MODERATION_GROUNDS = ['terms', 'law'] as const;
export type ModerationGround = (typeof MODERATION_GROUNDS)[number];

export const MODERATION_FACTS_MIN = 20;
export const MODERATION_FACTS_MAX = 1000;
export const MODERATION_GROUND_REFERENCE_MIN = 3;
export const MODERATION_GROUND_REFERENCE_MAX = 300;
export const MODERATION_RESTORE_REASON_MIN = 20;
export const MODERATION_RESTORE_REASON_MAX = 1000;

export type ModerationField = 'decision' | 'facts' | 'groundType' | 'groundReference';
export type ModerationFieldError = 'required' | 'tooShort' | 'tooLong' | 'scope';

export interface ModerationDecisionInput {
  decision: string;
  facts: string;
  groundType?: string | null;
  groundReference?: string | null;
  automatedDetection?: boolean;
}

export function isModerationDecision(value: unknown): value is ModerationDecision {
  return typeof value === 'string' && (MODERATION_DECISIONS as readonly string[]).includes(value);
}

export function isModerationGround(value: unknown): value is ModerationGround {
  return typeof value === 'string' && (MODERATION_GROUNDS as readonly string[]).includes(value);
}

/** Decyzja ogranicza treść (wymaga podstawy i powiadamia autora). */
export function decisionRestricts(decision: string): boolean {
  return decision === 'job_removed' || decision === 'company_suspended';
}

/**
 * Decyzje dozwolone dla celu zgłoszenia: zgłoszenie oferty może skończyć się wycofaniem
 * oferty albo zawieszeniem jej firmy; zgłoszenie firmy — zawieszeniem firmy.
 */
export function decisionsForTarget(targetType: string): ModerationDecision[] {
  return targetType === 'job'
    ? ['no_action', 'job_removed', 'company_suspended']
    : ['no_action', 'company_suspended'];
}

/** Pierwszy błąd pola (kolejność jak w formularzu) albo null. */
export function moderationDecisionError(
  input: ModerationDecisionInput,
  targetType: string,
): { field: ModerationField; error: ModerationFieldError } | null {
  if (!isModerationDecision(input.decision)) return { field: 'decision', error: 'required' };
  if (!decisionsForTarget(targetType).includes(input.decision)) {
    return { field: 'decision', error: 'scope' };
  }
  const facts = (input.facts ?? '').trim();
  if (facts.length === 0) return { field: 'facts', error: 'required' };
  if (facts.length < MODERATION_FACTS_MIN) return { field: 'facts', error: 'tooShort' };
  if (facts.length > MODERATION_FACTS_MAX) return { field: 'facts', error: 'tooLong' };
  if (decisionRestricts(input.decision)) {
    if (!isModerationGround(input.groundType)) return { field: 'groundType', error: 'required' };
    const reference = (input.groundReference ?? '').trim();
    if (reference.length === 0) return { field: 'groundReference', error: 'required' };
    if (reference.length < MODERATION_GROUND_REFERENCE_MIN) {
      return { field: 'groundReference', error: 'tooShort' };
    }
    if (reference.length > MODERATION_GROUND_REFERENCE_MAX) {
      return { field: 'groundReference', error: 'tooLong' };
    }
  }
  return null;
}

/** Błąd uzasadnienia przywrócenia treści albo null. */
export function restoreReasonError(reason: string | null | undefined): ModerationFieldError | null {
  const trimmed = (reason ?? '').trim();
  if (trimmed.length === 0) return 'required';
  if (trimmed.length < MODERATION_RESTORE_REASON_MIN) return 'tooShort';
  if (trimmed.length > MODERATION_RESTORE_REASON_MAX) return 'tooLong';
  return null;
}

/** Mapuje komunikat `VALIDATION_FAILED: …` z RPC na błąd pola (gdy da się je wskazać). */
export function moderationFieldFromDbMessage(
  message: string,
): { field: ModerationField | 'reason'; error: ModerationFieldError } | null {
  if (message.includes('FACTS_REQUIRED')) return { field: 'facts', error: 'tooShort' };
  if (message.includes('FACTS_TOO_LONG')) return { field: 'facts', error: 'tooLong' };
  if (message.includes('GROUND_REFERENCE_REQUIRED')) return { field: 'groundReference', error: 'required' };
  if (message.includes('GROUND_REFERENCE_TOO_LONG')) return { field: 'groundReference', error: 'tooLong' };
  if (message.includes('GROUND_REQUIRED')) return { field: 'groundType', error: 'required' };
  if (message.includes('DECISION_SCOPE')) return { field: 'decision', error: 'scope' };
  if (message.includes('REASON_REQUIRED')) return { field: 'reason', error: 'tooShort' };
  if (message.includes('REASON_TOO_LONG')) return { field: 'reason', error: 'tooLong' };
  return null;
}

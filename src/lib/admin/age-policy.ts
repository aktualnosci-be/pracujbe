/**
 * Reguły formularza progu wieku kandydatów (#492, panel admina `/admin/ustawienia`) — wspólne
 * dla dialogu (przeglądarka) i Server Action. Ten sam limit egzekwuje RPC
 * `admin_set_candidate_min_age` (migracja 0126, uzasadnienie ≤ 1000 znaków, zawsze wymagane).
 */

import { CANDIDATE_MIN_AGE_REASON_MAX } from '@/lib/age-policy/constants';

export { CANDIDATE_MIN_AGE_REASON_MAX as AGE_POLICY_REASON_MAX };

/** Błąd pola uzasadnienia albo null, gdy wartość jest poprawna. Uzasadnienie jest ZAWSZE wymagane. */
export function agePolicyReasonError(reason: string | null | undefined): 'required' | 'tooLong' | null {
  const trimmed = (reason ?? '').trim();
  if (trimmed.length === 0) return 'required';
  if (trimmed.length > CANDIDATE_MIN_AGE_REASON_MAX) return 'tooLong';
  return null;
}

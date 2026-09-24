import { z } from 'zod/v3';

import { CANDIDATE_MIN_AGE_HIGHEST, CANDIDATE_MIN_AGE_LOWEST } from './constants';

export {
  CANDIDATE_MIN_AGE_FALLBACK,
  CANDIDATE_MIN_AGE_HIGHEST,
  CANDIDATE_MIN_AGE_LOWEST,
  isAgeAttestationError,
  normalizeCandidateMinAge,
} from './constants';

/**
 * Polityka wieku kandydatów (#492) — schemat progu dla walidacji serwera i formularzy.
 *
 * Minimalizacja (RODO art. 5(1)(c)): kandydat deklaruje wyłącznie, że ma co najmniej N lat.
 * Nie zbieramy daty ani roku urodzenia ani dokumentu tożsamości. `minAge` to próg pokazany
 * w formularzu; baza porównuje go z bieżącym progiem, więc wartość od klienta niczego nie obniża.
 */
export const minAgeSchema = z
  .number({ invalid_type_error: 'errors.ageAttestationRequired' })
  .int('errors.ageAttestationRequired')
  .min(CANDIDATE_MIN_AGE_LOWEST, 'errors.ageAttestationRequired')
  .max(CANDIDATE_MIN_AGE_HIGHEST, 'errors.ageAttestationRequired');

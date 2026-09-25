import { z } from 'zod/v3';

import { isCandidateAgeBand } from './constants';

export {
  CANDIDATE_ADULT_AGE,
  CANDIDATE_AGE_BANDS,
  CANDIDATE_MIN_AGE_FALLBACK,
  CANDIDATE_MIN_AGE_HIGHEST,
  CANDIDATE_MIN_AGE_LOWEST,
  candidateAgeBandsFor,
  isAgeAdultRequiredError,
  isAgeAttestationError,
  isCandidateAgeBand,
  normalizeCandidateMinAge,
} from './constants';

/**
 * Polityka wieku kandydatów (#492) — schemat progu dla walidacji serwera i formularzy.
 *
 * Minimalizacja (RODO art. 5(1)(c)): kandydat potwierdza wyłącznie przedział wieku (16–17
 * albo 18+, #576) — `minAge` = dolna granica przedziału (16 albo 18). Nie zbieramy daty ani
 * roku urodzenia ani dokumentu tożsamości. Baza porównuje przedział z bieżącym progiem konta,
 * więc wartość od klienta niczego nie obniża.
 */
export const minAgeSchema = z
  .number({ invalid_type_error: 'errors.ageAttestationRequired', required_error: 'errors.ageAttestationRequired' })
  .refine(isCandidateAgeBand, 'errors.ageAttestationRequired');

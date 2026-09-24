/**
 * Polityka wieku kandydatów (#492) — granice i wartość awaryjna, bez zależności (moduł trafia
 * do JS formularzy publicznych, więc bez Zoda — #390).
 *
 * Próg jest DANYMI w bazie (`public.age_policy`, migracja 0110), nie stałą w kodzie. Tu są
 * tylko granice zakresu (takie same jak CHECK w bazie) i wartość awaryjna, gdy odczyt progu
 * się nie uda. Awaryjne 18 = górna granica zakresu, więc deklaracja „mam co najmniej 18 lat”
 * spełnia każdy dopuszczalny próg — błąd odczytu nie może obniżyć ochrony.
 */
export const CANDIDATE_MIN_AGE_LOWEST = 13;
export const CANDIDATE_MIN_AGE_HIGHEST = 18;
export const CANDIDATE_MIN_AGE_FALLBACK = CANDIDATE_MIN_AGE_HIGHEST;

/** Normalizuje wartość progu z bazy; nieznana/uszkodzona → wartość awaryjna (18). */
export function normalizeCandidateMinAge(value: unknown): number {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isInteger(n) && n >= CANDIDATE_MIN_AGE_LOWEST && n <= CANDIDATE_MIN_AGE_HIGHEST
    ? n
    : CANDIDATE_MIN_AGE_FALLBACK;
}

/** Komunikat bazy/RPC o braku ważnej deklaracji wieku. */
export function isAgeAttestationError(message: string | null | undefined): boolean {
  return (message ?? '').includes('AGE_ATTESTATION_REQUIRED');
}

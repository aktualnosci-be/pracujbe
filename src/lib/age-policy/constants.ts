/**
 * Polityka wieku kandydatów (#492, #576) — granice i wartość awaryjna, bez zależności (moduł
 * trafia do JS formularzy publicznych, więc bez Zoda — #390).
 *
 * Decyzja właściciela 25.09.2026 (#576, LAUNCH-1): konto kandydata od 16 lat, widoczność
 * profilu dla firm (#494) tylko dla pełnoletnich. Kandydat potwierdza PRZEDZIAŁ wieku
 * (16–17 albo 18+), bez daty urodzenia; zapisujemy dolną granicę przedziału (16 albo 18).
 *
 * Próg konta jest DANYMI w bazie (`public.age_policy`, migracja 0126: 16 albo 18), nie stałą
 * w kodzie. Wartość awaryjna 18 (gdy odczyt progu się nie uda) = formularz pokazuje tylko
 * przedział 18+ — błąd odczytu nie może obniżyć ochrony.
 */
export const CANDIDATE_MIN_AGE_LOWEST = 16;
export const CANDIDATE_MIN_AGE_HIGHEST = 18;
export const CANDIDATE_MIN_AGE_FALLBACK = CANDIDATE_MIN_AGE_HIGHEST;
/** Pełnoletność — próg widoczności profilu dla firm (stała, niezależna od progu konta). */
export const CANDIDATE_ADULT_AGE = 18;
/** Dolne granice przedziałów wieku, jak CHECK w bazie (`min_age in (16, 18)`). */
export const CANDIDATE_AGE_BANDS = [CANDIDATE_MIN_AGE_LOWEST, CANDIDATE_ADULT_AGE] as const;

export function isCandidateAgeBand(value: unknown): value is number {
  return typeof value === 'number' && (CANDIDATE_AGE_BANDS as readonly number[]).includes(value);
}

/** Normalizuje wartość progu z bazy; nieznana/uszkodzona → wartość awaryjna (18). */
export function normalizeCandidateMinAge(value: unknown): number {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return isCandidateAgeBand(n) ? n : CANDIDATE_MIN_AGE_FALLBACK;
}

/**
 * Przedziały do wyboru w formularzu przy danym progu konta: 16 → [16, 18], 18 → [18].
 * Przedział poniżej progu nie jest pokazywany (baza i tak by go odrzuciła).
 */
export function candidateAgeBandsFor(minAge: number): number[] {
  const threshold = normalizeCandidateMinAge(minAge);
  return CANDIDATE_AGE_BANDS.filter((band) => band >= threshold);
}

/** Komunikat bazy/RPC o braku ważnej deklaracji wieku. */
export function isAgeAttestationError(message: string | null | undefined): boolean {
  return (message ?? '').includes('AGE_ATTESTATION_REQUIRED');
}

/** Komunikat bazy/RPC: widoczność profilu tylko dla pełnoletnich (#576). */
export function isAgeAdultRequiredError(message: string | null | undefined): boolean {
  return (message ?? '').includes('AGE_ADULT_REQUIRED');
}

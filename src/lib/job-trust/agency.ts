/**
 * Agencje pracy tymczasowej (0910, decyzja właściciela 28.09.2026: agencje dopuszczone
 * z oznaczeniem). Firma deklaruje „agencja” i numer uznania regionalnego (tekst); admin
 * sprawdza go ręcznie w rejestrze regionu i zapisuje wynik. Publicznie widać tylko etykietę
 * „agencja” (bez wyniku sprawdzenia) i filtr „bezpośrednio od pracodawcy”.
 * Te same limity egzekwuje baza (`companies_agency_number_check`, `set_company_agency`).
 * Moduł bez zależności serwerowych.
 */

export const AGENCY_NUMBER_MAX = 64;
export const AGENCY_CHECK_NOTE_MAX = 1000;

export type AgencyCheckStatus = 'unchecked' | 'confirmed' | 'not_confirmed';

export function isAgencyCheckStatus(value: unknown): value is AgencyCheckStatus {
  return value === 'unchecked' || value === 'confirmed' || value === 'not_confirmed';
}

/** Błąd numeru uznania dla deklaracji „agencja” (numer wymagany). */
export function agencyNumberError(value: string | null | undefined): 'required' | 'tooLong' | null {
  const trimmed = (value ?? '').trim();
  if (trimmed.length === 0) return 'required';
  if (trimmed.length > AGENCY_NUMBER_MAX) return 'tooLong';
  return null;
}

/** Parametr adresu listy ofert dla filtra „bezpośrednio od pracodawcy”. */
export const DIRECT_ONLY_PARAM = 'bezposrednio';

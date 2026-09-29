import { parseBelgianVat, type BelgianVatFormatError } from '@/lib/vies/belgian-vat';
import { compareCompanyNames, type CompanyNameComparison } from '@/lib/vies/name-match';

/**
 * Stan weryfikacji VIES pokazywany administratorowi w szczególe firmy (#92).
 *
 * Zapisany wynik (0088) dotyczy konkretnego numeru — jeśli firma zmieniła numer, wynik jest
 * nieaktualny (`stale`). Stany niedostępności/limitu nie są zapisywane, więc tu nie występują:
 * pojawiają się wyłącznie jako odpowiedź na ręczne sprawdzenie.
 */

export interface StoredViesCheck {
  vatNumber: string;
  result: 'valid' | 'invalid';
  viesName: string | null;
  checkedAt: string;
}

export type AdminViesState =
  | { kind: 'no_vat' }
  | { kind: 'format_invalid'; reason: Exclude<BelgianVatFormatError, 'empty'> }
  | { kind: 'not_checked'; vatNumber: string }
  | { kind: 'stale'; vatNumber: string; checkedAt: string }
  | {
      kind: 'valid';
      vatNumber: string;
      checkedAt: string;
      viesName: string | null;
      nameMatch: CompanyNameComparison;
    }
  | { kind: 'invalid'; vatNumber: string; checkedAt: string }
  /** Nie udało się odczytać zapisanego wyniku — numer i tak można sprawdzić. */
  | { kind: 'load_error'; vatNumber: string };

/** Numer do sprawdzenia: VAT, a gdy go brak — numer KBO (ten sam numer przedsiębiorstwa). */
export function companyVatSource(
  vatNumber: string | null | undefined,
  registrationNumber: string | null | undefined,
): string | null {
  const vat = vatNumber?.trim();
  if (vat) return vat;
  const kbo = registrationNumber?.trim();
  return kbo || null;
}

export function buildViesState(input: {
  companyName: string;
  vatSource: string | null;
  stored: StoredViesCheck | null;
  storedLoadFailed?: boolean;
}): AdminViesState {
  const parsed = parseBelgianVat(input.vatSource);
  if (!parsed.ok) {
    return parsed.reason === 'empty'
      ? { kind: 'no_vat' }
      : { kind: 'format_invalid', reason: parsed.reason };
  }
  const vatNumber = parsed.number;
  if (input.storedLoadFailed) return { kind: 'load_error', vatNumber };
  const stored = input.stored;
  if (!stored) return { kind: 'not_checked', vatNumber };
  if (stored.vatNumber !== vatNumber) {
    return { kind: 'stale', vatNumber, checkedAt: stored.checkedAt };
  }
  if (stored.result === 'valid') {
    return {
      kind: 'valid',
      vatNumber,
      checkedAt: stored.checkedAt,
      viesName: stored.viesName,
      nameMatch: compareCompanyNames(input.companyName, stored.viesName),
    };
  }
  return { kind: 'invalid', vatNumber, checkedAt: stored.checkedAt };
}

/** Lustro `company_vies_auto_max_attempts()` (0192) — najwyżej tyle prób automatycznych. */
export const VIES_AUTO_MAX_ATTEMPTS = 10;

/**
 * Zadanie automatycznego sprawdzenia w kolejce (0192, #706/#879) — pokazywane adminowi, żeby
 * było widać, że wynik czeka na ponowienie (VIES był niedostępny) albo próby się wyczerpały.
 */
export interface ViesAutoRetry {
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  lastOutcome: 'unavailable' | 'rate_limited' | 'error' | null;
  /** Wyczerpane próby — kolejka nie ponowi sprawdzenia, zostaje ręczne. */
  exhausted: boolean;
}

/** Wiersz `company_vies_auto_queue` → stan dla panelu; zadanie dla innego numeru = brak. */
export function parseViesAutoRetry(
  row: Record<string, unknown> | null | undefined,
  currentNumber: string | null,
): ViesAutoRetry | null {
  if (!row || !currentNumber || row['vat_number'] !== currentNumber) return null;
  const attempts = Number(row['attempts']);
  const next = row['next_attempt_at'];
  const nextAttemptAt = next instanceof Date ? next.toISOString() : typeof next === 'string' ? next : null;
  if (!Number.isInteger(attempts) || attempts < 0 || !nextAttemptAt) return null;
  const outcome = row['last_outcome'];
  const lastOutcome =
    outcome === 'unavailable' || outcome === 'rate_limited' || outcome === 'error' ? outcome : null;
  return {
    attempts,
    maxAttempts: VIES_AUTO_MAX_ATTEMPTS,
    nextAttemptAt,
    lastOutcome,
    exhausted: attempts >= VIES_AUTO_MAX_ATTEMPTS,
  };
}

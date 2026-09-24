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

/**
 * Belgijski numer VAT / KBO (numer przedsiębiorstwa) — normalizacja i lokalny pre-check (#92).
 *
 * Numer przedsiębiorstwa ma 10 cyfr: pierwsza 0 lub 1, dwie ostatnie to suma kontrolna
 * `97 − (pierwsze 8 cyfr mod 97)`. Stary zapis 9-cyfrowy (sprzed 2005 r.) uzupełniamy
 * wiodącym zerem. Numer VAT = `BE` + numer przedsiębiorstwa.
 *
 * Numer, który nie przejdzie tej kontroli, nie trafia do VIES — to deterministyczna
 * informacja o błędnym zapisie, a nie wynik rejestru.
 */

export type BelgianVatFormatError = 'empty' | 'not_belgian' | 'length' | 'checksum';

export type BelgianVatParseResult =
  | { ok: true; /** 10 cyfr bez prefiksu `BE`. */ number: string }
  | { ok: false; reason: BelgianVatFormatError };

/** Czy dwie ostatnie cyfry zgadzają się z sumą kontrolną mod 97. */
export function hasValidBelgianChecksum(digits: string): boolean {
  if (!/^[01]\d{9}$/.test(digits)) return false;
  const base = Number(digits.slice(0, 8));
  const check = Number(digits.slice(8));
  return 97 - (base % 97) === check;
}

/**
 * Normalizuje zapis podany przez firmę (`BE 0417.497.106`, `be0417-497-106`, `417497106`)
 * do 10 cyfr i sprawdza format oraz sumę kontrolną. Inny prefiks kraju → `not_belgian`.
 */
export function parseBelgianVat(raw: string | null | undefined): BelgianVatParseResult {
  const compact = (raw ?? '').replace(/[\s.\-/]/g, '').toUpperCase();
  if (compact === '') return { ok: false, reason: 'empty' };

  let digits = compact;
  if (/^[A-Z]{2}/.test(compact)) {
    if (!compact.startsWith('BE')) return { ok: false, reason: 'not_belgian' };
    digits = compact.slice(2);
  }
  if (!/^\d+$/.test(digits)) return { ok: false, reason: 'length' };
  if (digits.length === 9) digits = `0${digits}`;
  if (digits.length !== 10 || !/^[01]/.test(digits)) return { ok: false, reason: 'length' };
  if (!hasValidBelgianChecksum(digits)) return { ok: false, reason: 'checksum' };
  return { ok: true, number: digits };
}

/** Zapis do wyświetlenia: `BE0417.497.106`. */
export function formatBelgianVat(number: string): string {
  return `BE${number.slice(0, 4)}.${number.slice(4, 7)}.${number.slice(7)}`;
}

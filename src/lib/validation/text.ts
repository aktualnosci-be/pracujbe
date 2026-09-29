/**
 * Wspólne reguły pól tekstowych i dat po stronie Zod (#1108).
 *
 * PostgreSQL nie przyjmuje znaku NUL w `text` (`invalid byte sequence`) ani dat spoza
 * zakresu (rok 0000, miesiąc 13). Bez tych reguł wartość przechodziła walidację formularza,
 * a odrzucała ją dopiero baza — użytkownik widział ogólny błąd techniczny zamiast komunikatu
 * przy polu.
 */

/**
 * Wzorzec dla `z.string().regex(...)` — regex zamiast `.refine`, bo pozostaje sprawdzeniem
 * `ZodString` (schematy wystawiają `maxLength`/`innerType`, z których korzysta m.in. import CV).
 */
// eslint-disable-next-line no-control-regex
export const NO_NUL_REGEX = /^[^\u0000]*$/;

/** Tekst bez znaku NUL (`\u0000`). */
export function hasNoNul(value: string): boolean {
  return !value.includes('\u0000');
}

/** Liczba znaków (punktów kodowych) — tak liczy `char_length`/`left` w PostgreSQL. */
export function codePointLength(value: string): number {
  let n = 0;
  for (const _ of value) n += 1;
  return n;
}

/** Pierwsze `max` punktów kodowych (odpowiednik `left(value, max)` w SQL). */
export function truncateCodePoints(value: string, max: number): string {
  return codePointLength(value) <= max ? value : Array.from(value).slice(0, max).join('');
}

/** Zakres lat dat wpisywanych przez użytkownika (ważność certyfikatu, start pracy). */
export const MIN_DATE_YEAR = 1900;
export const MAX_DATE_YEAR = 2100;

/**
 * Data kalendarzowa `YYYY-MM-DD` istniejąca w kalendarzu, z rokiem w rozsądnym zakresie
 * (`0000-01-01` przechodziła sam kontrolę kalendarza, a baza ją odrzuca).
 */
export function isPlausibleCalendarDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  if (year < MIN_DATE_YEAR || year > MAX_DATE_YEAR) return false;
  const d = new Date(Date.UTC(year, Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === value;
}

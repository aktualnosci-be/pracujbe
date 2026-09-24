/**
 * Deterministyczne wykrywanie i redakcja danych, których Pracuj.be nie zbiera na etapie
 * aplikacji ani nie przekazuje do importu AI (#495, #500).
 *
 * Rodzaje:
 *   - `nationalId` — belgijski numer rejestru narodowego (NISS/INSZ) i numer BIS (suma
 *     kontrolna mod 97, obie reguły: urodzeni przed 2000 i od 2000), PESEL (wagi 1-3-7-9)
 *     oraz dowolny ciąg ≥ 6 cyfr bezpośrednio po słowie kluczowym (NISS, INSZ, rijksregister,
 *     numéro national, PESEL…) — także z błędną sumą: użytkownik wyraźnie podaje numer;
 *   - `document` — numer belgijskiej karty eID/karty pobytu (12 cyfr, suma mod 97, zapis
 *     `XXX-XXXXXXX-YY`) i numer po słowie kluczowym dokumentu (paszport, dowód osobisty,
 *     identiteitskaart, carte d'identité…);
 *   - `email`, `phone` — dane kontaktowe (używane w imporcie ogłoszenia, nie w aplikacji,
 *     gdzie kandydat świadomie podaje swój telefon).
 *
 * Ograniczenia (świadome): wykrywanie działa na TEKŚCIE. Nie odczytuje obrazów ani skanów
 * i nie wykryje numeru zapisanego słownie, rozbitego w nietypowy sposób lub w formacie
 * innego kraju bez słowa kluczowego. Moduł jest czysty (bez `server-only`) — te same reguły
 * mogą działać w przeglądarce i na serwerze; o zapisie decyduje zawsze serwer.
 */

export type SensitiveKind = 'nationalId' | 'document' | 'email' | 'phone';

export interface SensitiveMatch {
  kind: SensitiveKind;
  start: number;
  end: number;
}

/** Kategorie identyfikatorów zakazanych w aplikacji (formularze kandydata i gościa). */
export const IDENTIFIER_KINDS: readonly SensitiveKind[] = ['nationalId', 'document'];
/** Wszystkie kategorie — materiał wysyłany do importu AI. */
export const ALL_SENSITIVE_KINDS: readonly SensitiveKind[] = ['nationalId', 'document', 'email', 'phone'];

const onlyDigits = (s: string): string => s.replace(/\D/g, '');

/* ---------------------------------------------------------------------------
 * Sumy kontrolne
 * ------------------------------------------------------------------------- */

/**
 * Numer rejestru narodowego / BIS: RRMMDD + nr porządkowy (3) + suma (2).
 * Suma = 97 − (pierwsze 9 cyfr mod 97); dla urodzonych od 2000 r. liczymy z prefiksem „2”.
 * BIS: miesiąc +20 (płeć nieznana) albo +40 (płeć znana); 00 = nieznany miesiąc/dzień.
 */
export function isValidBelgianNationalNumber(value: string): boolean {
  const d = onlyDigits(value);
  if (d.length !== 11) return false;
  const month = Number(d.slice(2, 4));
  const day = Number(d.slice(4, 6));
  const serial = Number(d.slice(6, 9));
  const monthOk = month <= 12 || (month >= 20 && month <= 32) || (month >= 40 && month <= 52);
  if (!monthOk || day > 31 || serial === 0 || serial === 999) return false;
  const base = Number(d.slice(0, 9));
  const check = Number(d.slice(9));
  const sum = (n: number): number => 97 - (n % 97);
  return sum(base) === check || sum(2_000_000_000 + base) === check;
}

/** PESEL: wagi 1-3-7-9, miesiąc koduje stulecie, poprawna data. */
export function isValidPesel(value: string): boolean {
  const d = onlyDigits(value);
  if (d.length !== 11) return false;
  const weights = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];
  const sum = weights.reduce((acc, w, i) => acc + w * Number(d[i]), 0);
  if ((10 - (sum % 10)) % 10 !== Number(d[10])) return false;
  const rawMonth = Number(d.slice(2, 4));
  const month = rawMonth % 20;
  const day = Number(d.slice(4, 6));
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

/** Numer belgijskiej karty eID / karty pobytu: 10 cyfr + suma (mod 97, 0 → 97). */
export function isValidBelgianCardNumber(value: string): boolean {
  const d = onlyDigits(value);
  if (d.length !== 12) return false;
  const rest = Number(d.slice(0, 10)) % 97;
  return (rest === 0 ? 97 : rest) === Number(d.slice(10));
}

/* ---------------------------------------------------------------------------
 * Wzorce
 * ------------------------------------------------------------------------- */

// Granice: bez cyfry/litery przed i po, bez „+” przed (numer telefonu +32…).
const PRE = String.raw`(?<![\p{L}\p{N}+])`;
const POST = String.raw`(?![\p{L}\p{N}])`;
const SEP = String.raw`[ .\-/]?`;

/** 11 cyfr w układzie RR.MM.DD-SSS.CC (dowolne z separatorów „ .-/” albo bez nich). */
const ELEVEN_DIGITS = new RegExp(
  `${PRE}\\d{2}${SEP}\\d{2}${SEP}\\d{2}${SEP}\\d{3}${SEP}\\d{2}${POST}`,
  'gu',
);
/** PESEL zwykle bez separatorów. */
const PLAIN_ELEVEN = new RegExp(`${PRE}\\d{11}${POST}`, 'gu');
/** Karta eID: XXX-XXXXXXX-YY albo 12 cyfr. */
const CARD_NUMBER = new RegExp(`${PRE}(?:\\d{3}[ \\-]?\\d{7}[ \\-]?\\d{2})${POST}`, 'gu');

const NATIONAL_KEYWORDS = [
  'niss',
  'insz',
  'ssin',
  'rijksregister(?:nummer)?',
  'registre national',
  'num[ée]ro (?:de registre )?national',
  'national (?:register|registry|insurance|identification) number',
  'bis[- ]?(?:nummer|number|numer|num[ée]ro)',
  'num[ée]ro bis',
  'pesel',
  'numer ewidencyjny',
  'social security number',
  'numer (?:ubezpieczenia|identyfikacyjny)',
];
const DOCUMENT_KEYWORDS = [
  'passports?',
  'paspoort(?:nummer)?',
  'passeport',
  'paszport(?:u|em)?',
  'dow[óo]d(?:u|em)? osobist(?:y|ego|ym)',
  'nr dowodu',
  'numer dowodu',
  'identity card',
  'id card',
  'identiteitskaart',
  'carte d.identit[ée]',
  'e-?id',
  'verblijfskaart',
  'carte de s[ée]jour',
  'karta pobytu',
  'karty pobytu',
  'residence (?:card|permit)',
  'document(?:nummer| number)',
  'num[ée]ro de document',
  'numer dokumentu',
  'rijbewijsnummer',
  'num[ée]ro de permis',
  'numer prawa jazdy',
  'driving licen[cs]e number',
];
// Słowo kluczowe, potem najwyżej kilka łączników („nr”, „:”, „is”, „to”…), potem numer.
const LINKERS = String.raw`(?:[\s:#°=\-]*(?:nr|no|num|n°|nummer|number|numer|num[ée]ro|is|to|est|jest|mijn|my|mon|m[óo]j|van|de|du)\.?)*[\s:#°=\-]*`;
const ID_TOKEN = String.raw`[A-Z]{0,3}[ \-]?\d[\d .\/\-]{3,22}\d`;

function keywordPattern(keywords: string[]): RegExp {
  return new RegExp(
    `(?<![\\p{L}])(?:${keywords.join('|')})(?![\\p{L}])${LINKERS}(${ID_TOKEN})${POST}`,
    'giu',
  );
}
const NATIONAL_CONTEXT = keywordPattern(NATIONAL_KEYWORDS);
const DOCUMENT_CONTEXT = keywordPattern(DOCUMENT_KEYWORDS);

const EMAIL = /[\p{L}\p{N}._%+\-]+@[\p{L}\p{N}\-]+(?:\.[\p{L}\p{N}\-]+)*\.\p{L}{2,}/gu;
/** Międzynarodowy: +XX / 00XX, potem 7–12 cyfr z separatorami; opcjonalne „(0)”. */
const PHONE_INTL = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(?:\+|00)\d{1,3}(?:[ .\-/]?\(0\))?(?:[ .\-/]?\d){7,12}${POST}`,
  'gu',
);
/** Krajowy (BE/NL/FR/LU/DE): 0 + 8–9 cyfr, np. 0471 23 45 67, 02/123.45.67. */
const PHONE_NATIONAL = new RegExp(String.raw`${PRE}0\d(?:[ .\-/]?\d){7,8}${POST}`, 'gu');
/** Data na początku dopasowania (01.09.2026 …) — to nie numer telefonu. */
const DATE_PREFIX = /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/;

function collect(re: RegExp, text: string, kind: SensitiveKind, accept: (m: string) => boolean, group = 0): SensitiveMatch[] {
  const out: SensitiveMatch[] = [];
  re.lastIndex = 0;
  for (const m of text.matchAll(re)) {
    const value = m[group];
    if (value === undefined || m.index === undefined) continue;
    if (!accept(value)) continue;
    const start = group === 0 ? m.index : m.index + m[0].lastIndexOf(value);
    out.push({ kind, start, end: start + value.length });
  }
  return out;
}

/** Zwraca rozłączne dopasowania (dłuższe wygrywają przy nakładaniu), posortowane. */
export function findSensitiveData(
  text: string,
  kinds: readonly SensitiveKind[] = ALL_SENSITIVE_KINDS,
): SensitiveMatch[] {
  if (!text) return [];
  const want = new Set(kinds);
  const all: SensitiveMatch[] = [];
  if (want.has('nationalId')) {
    all.push(...collect(ELEVEN_DIGITS, text, 'nationalId', isValidBelgianNationalNumber));
    all.push(...collect(PLAIN_ELEVEN, text, 'nationalId', isValidPesel));
    all.push(...collect(NATIONAL_CONTEXT, text, 'nationalId', (v) => onlyDigits(v).length >= 6, 1));
  }
  if (want.has('document')) {
    all.push(...collect(CARD_NUMBER, text, 'document', isValidBelgianCardNumber));
    all.push(...collect(DOCUMENT_CONTEXT, text, 'document', (v) => onlyDigits(v).length >= 6, 1));
  }
  if (want.has('email')) all.push(...collect(EMAIL, text, 'email', () => true));
  if (want.has('phone')) {
    all.push(...collect(PHONE_INTL, text, 'phone', (v) => onlyDigits(v).length >= 9));
    all.push(...collect(PHONE_NATIONAL, text, 'phone', (v) => !DATE_PREFIX.test(v)));
  }
  all.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  const out: SensitiveMatch[] = [];
  for (const m of all) {
    const last = out[out.length - 1];
    if (last && m.start < last.end) {
      if (m.end > last.end) last.end = m.end; // scalamy nakładające się fragmenty
      continue;
    }
    out.push({ ...m });
  }
  return out;
}

/** Czy tekst zawiera numer identyfikacyjny osoby lub dokumentu (walidacja formularzy aplikacji). */
export function containsPersonalIdentifier(text: string | null | undefined): boolean {
  return !!text && findSensitiveData(text, IDENTIFIER_KINDS).length > 0;
}

export const REDACTION_MARKERS: Record<SensitiveKind, string> = {
  nationalId: '[identifier removed]',
  document: '[identifier removed]',
  email: '[email removed]',
  phone: '[phone removed]',
};

export interface RedactionResult {
  text: string;
  /** Liczba usuniętych fragmentów per rodzaj — bez samych wartości (nie trafiają do logów). */
  counts: Record<SensitiveKind, number>;
}

/** Zastępuje wykryte fragmenty neutralnym znacznikiem. */
export function redactSensitiveData(
  text: string,
  kinds: readonly SensitiveKind[] = ALL_SENSITIVE_KINDS,
): RedactionResult {
  const counts: Record<SensitiveKind, number> = { nationalId: 0, document: 0, email: 0, phone: 0 };
  const matches = findSensitiveData(text, kinds);
  if (matches.length === 0) return { text, counts };
  let out = '';
  let cursor = 0;
  for (const m of matches) {
    out += text.slice(cursor, m.start) + REDACTION_MARKERS[m.kind];
    cursor = m.end;
    counts[m.kind] += 1;
  }
  out += text.slice(cursor);
  return { text: out, counts };
}

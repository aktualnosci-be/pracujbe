import type { Locale } from '@/i18n/routing';
import { DO_NOT_TRANSLATE } from '@/lib/translation/glossary';

/**
 * Deterministyczna kontrola niezmienności faktów (#32). Z tekstu źródła i przekładu
 * wyciągamy te same kategorie faktów i porównujemy je jako multizbiory (kolejność w zdaniu
 * może się zmienić, liczba wystąpień — nie). Rozbieżność = przekład odrzucony.
 *
 * Kategorie (kolejność ekstrakcji; dopasowany fragment jest maskowany, więc np. cyfry
 * telefonu nie wracają jako liczby):
 *   e-maile → adresy URL/domeny → daty → godziny → telefony → liczby (z konwencją separatorów
 *   języka tekstu: „15,50” pl/nl/fr = „15.50” en) → waluty → jednostki (%, km, kg…) →
 *   pojęcia brutto/netto i okres stawki (godzina/miesiąc) → terminy chronione (kwalifikacje
 *   z glosariusza, oznaczenia litera+cyfra jak BA4/C95, nazwy własne przekazane jawnie) →
 *   obecność negacji.
 *
 * Kontrola jest celowo zachowawcza (fail-closed): liczba zapisana słownie w przekładzie albo
 * zmieniony format daty kończy się odrzuceniem, a nie zgadywaniem. Nie wykrywa zmian
 * znaczenia poza tymi kategoriami — jakość ocenia benchmark (#30) i człowiek.
 */

export type FactKind =
  | 'emails'
  | 'urls'
  | 'dates'
  | 'times'
  | 'phones'
  | 'numbers'
  | 'currencies'
  | 'units'
  | 'pay_terms'
  | 'terms'
  | 'negation';

export interface Facts {
  emails: string[];
  urls: string[];
  dates: string[];
  times: string[];
  phones: string[];
  numbers: string[];
  currencies: string[];
  units: string[];
  /** Pojęcia obecne w tekście: gross, net, per_hour, per_month (zbiór, nie multizbiór). */
  pay_terms: string[];
  terms: string[];
  negation: boolean;
  /**
   * Obecność negacji w kolejnych zdaniach/wierszach (#1106) — przy tej samej liczbie zdań
   * w źródle i przekładzie porównujemy je zdanie po zdaniu, więc gubiąca się negacja nie jest
   * maskowana inną negacją w innym miejscu pola.
   */
  negations: boolean[];
}

const NOT_LETTER_BEFORE = '(?<![\\p{L}\\p{N}_])';
const NOT_LETTER_AFTER = '(?![\\p{L}\\p{N}_])';

function word(pattern: string): RegExp {
  return new RegExp(`${NOT_LETTER_BEFORE}(?:${pattern})${NOT_LETTER_AFTER}`, 'giu');
}

/** Zbiera dopasowania i zastępuje je spacjami (ta sama długość, bez sklejania sąsiadów). */
function take(text: { value: string }, re: RegExp, map: (m: (i: number) => string) => string | null): string[] {
  const out: string[] = [];
  text.value = text.value.replace(re, (...args: unknown[]) => {
    const match = String(args[0]);
    const value = map((i) => (typeof args[i] === 'string' ? (args[i] as string) : ''));
    if (value === null) return match;
    out.push(value);
    return ' '.repeat(match.length);
  });
  return out;
}

const TRAILING_PUNCT = /[.,;:!?]+$/;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function isoDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/**
 * Data numeryczna wg konwencji języka tekstu (#739): pl/nl/fr = dzień/miesiąc/rok; en z ukośnikiem
 * = miesiąc/dzień/rok (gdy taka kolejność jest niemożliwa, np. 25/12/2025, dzień/miesiąc);
 * en z kropką lub myślnikiem zostaje dzień/miesiąc/rok (zapis europejski). Zapis niejednoznaczny
 * rozstrzyga konwencja — inna interpretacja przekładu = odrzucenie (fail-closed).
 */
function numericDate(y: number, a: number, b: number, sep: string, locale: Locale): string | null {
  if (locale === 'en' && sep === '/') return isoDate(y, a, b) ?? isoDate(y, b, a);
  return isoDate(y, b, a);
}

/** Kanoniczna postać liczby wg konwencji separatorów języka tekstu. */
export function canonicalNumber(token: string, locale: Locale): string {
  let t = token.replace(/[\s  ]/g, '');
  const hasDot = t.includes('.');
  const hasComma = t.includes(',');
  let intPart = t;
  let frac = '';
  if (hasDot && hasComma) {
    const last = Math.max(t.lastIndexOf('.'), t.lastIndexOf(','));
    intPart = t.slice(0, last).replace(/[.,]/g, '');
    frac = t.slice(last + 1);
  } else if (hasDot || hasComma) {
    const sep = hasDot ? '.' : ',';
    const parts = t.split(sep);
    // „1,500” (en) i „1.500” (pl/nl/fr) to separator tysięcy; pojedynczy separator z inną
    // liczbą cyfr po nim jest dziesiętny.
    const thousandsSep = locale === 'en' ? ',' : '.';
    const thousands =
      parts.length > 2 || (sep === thousandsSep && parts.length === 2 && (parts[1] ?? '').length === 3);
    if (thousands) {
      intPart = parts.join('');
    } else {
      intPart = parts[0] ?? '';
      frac = parts[1] ?? '';
    }
  }
  t = intPart.replace(/^0+(?=\d)/, '');
  frac = frac.replace(/0+$/, '');
  return frac ? `${t}.${frac}` : t;
}

const CURRENCY_WORD_RE = word('eur|euros?|pln|zł(?:otych|ote|oty)?|usd|gbp');
const CURRENCY_SYMBOL_RE = /[€£$]/gu;
function currencyCode(raw: string): string {
  const v = raw.toLowerCase();
  if (v === '€' || v.startsWith('eur')) return 'EUR';
  if (v === 'pln' || v.startsWith('zł')) return 'PLN';
  if (v === 'usd' || v === '$') return 'USD';
  return 'GBP';
}

/**
 * Normalizuje wielkość liter adresu URL wyłącznie w schemacie i hoście (case-insensitive
 * wg RFC 3986 §6.2.2.1); ścieżka, query i fragment zostają dokładnie takie jak w tekście —
 * mogą rozróżniać wielkość liter (token, slug, parametr). Adres bez rozpoznanego schematu
 * (dopasowanie „gołej” domeny — regexp dopuszcza tam tylko małe litery) zostaje bez zmian.
 */
export function normalizeUrlCase(raw: string): string {
  const schemeMatch = raw.match(/^https?:\/\//iu);
  if (schemeMatch) {
    const scheme = schemeMatch[0].toLowerCase();
    const rest = raw.slice(schemeMatch[0].length);
    const hostEnd = rest.search(/[/?#]/u);
    const host = hostEnd === -1 ? rest : rest.slice(0, hostEnd);
    const afterHost = hostEnd === -1 ? '' : rest.slice(hostEnd);
    return scheme + host.toLowerCase() + afterHost;
  }
  if (/^www\./iu.test(raw)) {
    const hostEnd = raw.search(/[/?#]/u);
    const host = hostEnd === -1 ? raw : raw.slice(0, hostEnd);
    const afterHost = hostEnd === -1 ? '' : raw.slice(hostEnd);
    return host.toLowerCase() + afterHost;
  }
  return raw.toLowerCase();
}

/**
 * Normalizuje wielkość liter adresu e-mail wyłącznie w domenie (case-insensitive wg
 * RFC 5321 §2.4); local-part (przed `@`) zostaje dokładnie taki jak w tekście — SMTP
 * może traktować go jako rozróżniający wielkość liter.
 */
export function normalizeEmailCase(raw: string): string {
  const at = raw.lastIndexOf('@');
  if (at === -1) return raw.toLowerCase();
  return raw.slice(0, at) + raw.slice(at).toLowerCase();
}

/**
 * Adres e-mail z kotwicą na początku lokalnej części i limitami długości (RFC 5321) — bez nich
 * długi jednolity ciąg znaków daje złożoność kwadratową (#1108). Wyrażenie jest współdzielone
 * (globalne, ale używane tylko przez `replace`/`match`, które zerują `lastIndex`).
 */
const EMAIL_RE =
  /(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]{1,254}@[\p{L}\p{N}.-]{1,253}\.[\p{L}]{2,63}/gu;

const UNIT_RE = new RegExp(`(?<=\\d[\\s\\u00a0\\u202f]?)(%|km/h|km|kg|cm|mm|m²|m2|m³|m3|°C)${NOT_LETTER_AFTER}`, 'giu');
function unitCode(raw: string): string {
  return raw.toLowerCase().replace('m2', 'm²').replace('m3', 'm³');
}

const PAY_TERMS: Record<'gross' | 'net' | 'per_hour' | 'per_month', Record<Locale, string>> = {
  gross: { pl: 'brutto', nl: 'bruto', fr: 'brut|brute|bruts|brutes', en: 'gross' },
  net: { pl: 'netto', nl: 'netto', fr: 'net|nette|nets|nettes', en: 'net' },
  // Pełne słowa rozpoznajemy same; skróty jednoliterowe — tylko w kontekście
  // (`PER_HOUR_ABBREVIATION`), bo np. niderlandzkie „u” to także „Pan/Pani” (#1067).
  per_hour: {
    pl: 'godz\\.?|godzin[aęy]?|godzinowa|godzinowy|godzinowe',
    nl: 'uur|uurloon',
    fr: 'heures?|horaires?',
    en: 'hours?|hourly',
  },
  per_month: {
    pl: 'miesiąc|miesięcznie|miesięczn[aey]|mies\\.?',
    nl: 'maand|maandelijks|maandloon',
    fr: 'mois|mensuel(?:le)?s?',
    en: 'months?|monthly',
  },
};

/**
 * Skróty okresu stawki godzinowej (h, u, hr) — liczą się WYŁĄCZNIE tuż po liczbie, symbolu
 * waluty albo ukośniku („15 u”, „15h”, „€/u”, „/h”). Samo „u” w niderlandzkiej formie
 * grzecznościowej („wij bieden u aan…”) nie jest okresem stawki (#1067).
 */
const PER_HOUR_ABBREVIATION: Record<Locale, string> = {
  pl: 'h',
  nl: 'u|h',
  fr: 'h',
  en: 'hr|h',
};
const ABBREVIATION_CONTEXT = '(?<=[\\d€£$/][\\s\\u00a0\\u202f]?)';
function perHourAbbreviation(locale: Locale): RegExp {
  return new RegExp(`${ABBREVIATION_CONTEXT}(?:${PER_HOUR_ABBREVIATION[locale]})${NOT_LETTER_AFTER}`, 'iu');
}

const NEGATION: Record<Locale, string> = {
  pl: 'nie|bez|brak|brakuje|żaden|żadna|żadne|żadnego|żadnej|żadnych|nigdy|ani|niewymagan[aey]|niekonieczn[aey]',
  nl: 'niet|geen|zonder|nooit|noch|niets|nergens',
  fr: 'ne|pas|sans|aucun|aucune|aucuns|aucunes|jamais|ni|non|nul|nulle',
  en: 'not|no|never|without|none|nor|cannot',
};
// Formy ściągnięte: fr „n'est”, en „don't”.
const NEGATION_CONTRACTED: Partial<Record<Locale, RegExp>> = {
  fr: /(?<![\p{L}])n['’](?=\p{L})/iu,
  en: /\p{L}n['’]t(?![\p{L}])/iu,
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function termRegExp(term: string): RegExp {
  return new RegExp(`${NOT_LETTER_BEFORE}${escapeRegExp(term)}${NOT_LETTER_AFTER}`, 'gu');
}

function countTerm(text: string, term: string): number {
  return text.match(termRegExp(term))?.length ?? 0;
}

/** Oznaczenia kwalifikacji: wielka litera + cyfra (BA4, C95, CE1). */
const QUALIFICATION_RE = /(?<![\p{L}\p{N}_-])\p{Lu}[\p{L}]*\d[\p{L}\p{N}]*(?![\p{L}\p{N}_])/gu;

/** Zdania i wiersze (kończące się `.`, `!`, `?`, `…` albo końcem linii); puste pomijane. */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+|\n+/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Wyciąga fakty z jednego tekstu. `protectedTerms` — nazwy własne (np. firma), dosłownie. */
export function extractFacts(input: string, locale: Locale, protectedTerms: readonly string[] = []): Facts {
  const original = input.normalize('NFC');
  const text = { value: original };

  const emails = take(text, EMAIL_RE, (m) => normalizeEmailCase(m(0)));
  // Goła domena: etykiety ≤ 63 znaki, ≤ 21 etykiet — bez limitów ciąg „a.a.a.…” bez znanej
  // końcówki dawał złożoność kwadratową (#1108); prawdziwe domeny mieszczą się w limitach.
  const urls = take(
    text,
    /\b(?:https?:\/\/|www\.)[^\s<>"'()]+|\b[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63}){0,20}\.(?:be|com|eu|nl|fr|pl|org|net|lu|de|io|uk)\b(?:\/[^\s<>"'()]*)?/giu,
    (m) => normalizeUrlCase(m(0).replace(TRAILING_PUNCT, '')),
  );
  const dates = [
    ...take(text, /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g, (m) => isoDate(+m(1), +m(2), +m(3))),
    ...take(text, /(?<![\d.,])(\d{1,2})([./-])(\d{1,2})[./-](\d{4})(?!\d)/g, (m) =>
      numericDate(+m(4), +m(1), +m(3), m(2), locale),
    ),
  ];
  const times = take(text, /(?<![\d.,:])([01]?\d|2[0-3])\s?[:hu]\s?([0-5]\d)(?![\d])/giu, (m) => `${pad2(+m(1))}:${m(2)}`);
  const phones = take(text, /(?<!\d[\s\u00a0.,]?)(?:\+|00|0)\d[\d\s ().\/-]{6,}\d/g, (m) => {
    const digits = m(0).replace(/\D/g, '');
    if (digits.length < 9) return null;
    return m(0).trim().startsWith('+') ? `+${digits}` : digits.replace(/^00/, '+');
  });
  // Cyfry w oznaczeniach kwalifikacji (BA4, C95, Code 95) liczymy jako termin, nie liczbę.
  text.value = text.value.replace(QUALIFICATION_RE, (t) => ' '.repeat(t.length));
  for (const term of DO_NOT_TRANSLATE) {
    text.value = text.value.replace(termRegExp(term), (t) => ' '.repeat(t.length));
  }
  const numbers = take(
    text,
    // Znak (#738): `-`/`−` tuż przed cyfrą i nie po literze/cyfrze/separatorze (zakres „5-10”
    // i „B-2” nie są liczbami ujemnymi) jest częścią faktu; `+` jest pomijany (5 = +5).
    /(?:(?<![\p{L}\p{N}_.,+−-])([-−+])(?=\d))?(?<![\d.,])(\d{1,3}(?:[   ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)*)(?![\d])/gu,
    (m) => {
      const value = canonicalNumber(m(2), locale);
      return m(1) === '-' || m(1) === '−' ? (/^0(\.0*)?$/.test(value) ? value : `-${value}`) : value;
    },
  );
  // Waluty, jednostki i pojęcia liczymy na tekście z zamaskowanymi adresami i telefonami,
  // ale z liczbami na miejscu (jednostka musi stać tuż po liczbie).
  const rest = { value: original };
  for (const re of [
    EMAIL_RE,
    /\b(?:https?:\/\/|www\.)[^\s<>"'()]+/giu,
  ]) {
    rest.value = rest.value.replace(re, (s) => ' '.repeat(s.length));
  }
  const currencies = [
    ...(rest.value.match(CURRENCY_WORD_RE) ?? []),
    ...(rest.value.match(CURRENCY_SYMBOL_RE) ?? []),
  ].map(currencyCode);
  const units = (rest.value.match(UNIT_RE) ?? []).map(unitCode);

  const withoutTimes = rest.value.replace(/(?<![\d.,:])([01]?\d|2[0-3])\s?[:hu]\s?([0-5]\d)(?![\d])/giu, (s) => ' '.repeat(s.length));
  const pay_terms = (Object.keys(PAY_TERMS) as (keyof typeof PAY_TERMS)[]).filter(
    (k) =>
      word(PAY_TERMS[k][locale]).test(withoutTimes) ||
      (k === 'per_hour' && perHourAbbreviation(locale).test(withoutTimes)),
  );

  const terms: string[] = [];
  for (const term of new Set([...DO_NOT_TRANSLATE, ...protectedTerms.map((t) => t.trim()).filter(Boolean)])) {
    const n = countTerm(original, term);
    for (let i = 0; i < n; i++) terms.push(term);
  }
  // Oznaczenia kwalifikacji: wielka litera + cyfra (BA4, C95, CE1); bez już policzonych.
  const known = new Set(terms);
  for (const m of original.matchAll(QUALIFICATION_RE)) {
    if (!known.has(m[0])) terms.push(m[0]);
  }

  const hasNegation = (s: string) =>
    word(NEGATION[locale]).test(s) || (NEGATION_CONTRACTED[locale]?.test(s) ?? false);
  const negation = hasNegation(original);
  const negations = splitSentences(original).map(hasNegation);

  const sort = (a: string[]) => [...a].sort();
  return {
    emails: sort(emails),
    urls: sort(urls),
    dates: sort(dates),
    times: sort(times),
    phones: sort(phones),
    numbers: sort(numbers),
    currencies: sort(currencies),
    units: sort(units),
    pay_terms: sort(pay_terms),
    terms: sort(terms),
    negation,
    negations,
  };
}

/** Pierwsza kategoria, w której przekład różni się od źródła, albo `null`. */
export function compareFacts(source: Facts, translation: Facts): FactKind | null {
  const kinds: Exclude<FactKind, 'negation'>[] = [
    'emails',
    'urls',
    'dates',
    'times',
    'phones',
    'numbers',
    'currencies',
    'units',
    'pay_terms',
    'terms',
  ];
  for (const k of kinds) {
    const a = source[k];
    const b = translation[k];
    if (a.length !== b.length || a.some((v, i) => v !== b[i])) return k;
  }
  if (source.negation !== translation.negation) return 'negation';
  // Ta sama liczba zdań (>= 2) → negacja musi się zgadzać zdanie po zdaniu. Inna liczba zdań
  // (przekład łączy/dzieli zdania, skróty z kropką) → wystarcza porównanie całego pola wyżej.
  const a = source.negations;
  const b = translation.negations;
  if (a.length >= 2 && a.length === b.length && a.some((v, i) => v !== b[i])) return 'negation';
  return null;
}

/**
 * Rdzeń sluga ASCII dla adresów SEO (oferty, firmy) — jedno źródło (#1108).
 *
 * `normalize('NFKD')` + usunięcie znaków łączących rozkłada tylko litery z akcentami (é, ą, ü…).
 * Litery, które NIE mają rozkładu (ł, ø, đ, ß, æ, œ, þ, ð, ı), wypadały wcześniej ze sluga
 * (np. „Łódź” → „odz”, „Straße” → „stra-e”). Zastępujemy je najbliższym odpowiednikiem
 * łacińskim przed rozkładem.
 */
const LATIN_TRANSLITERATION: Readonly<Record<string, string>> = {
  ł: 'l',
  ø: 'o',
  đ: 'd',
  ð: 'd',
  ı: 'i',
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  þ: 'th',
};
const LATIN_TRANSLITERATION_RE = /[łøđðıßæœþ]/g;

/** Mała litera po transliteracji; NFKD rozkłada ligatury (ﬁ) i akcenty. */
export function asciiSlugBase(input: string, maxLength: number): string {
  return input
    .toLowerCase()
    .replace(LATIN_TRANSLITERATION_RE, (ch) => LATIN_TRANSLITERATION[ch] ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
}

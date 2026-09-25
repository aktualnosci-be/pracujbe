/**
 * Lustro `public.search_fold` (0110, #47) dla danych demonstracyjnych: małe litery bez znaków
 * diakrytycznych w alfabecie łacińskim, żeby „sprzatania” znajdowało „sprzątania”, a „liege” —
 * „Liège”, jak w SQL. Jak słownik `unaccent`: cyrylicy nie zmieniamy (poza ё → е), litery bez
 * rozkładu Unicode (ł, đ, ø, ß, æ, œ, ı) mapujemy jawnie.
 */
const EXTRA: Record<string, string> = { ł: 'l', đ: 'd', ø: 'o', ß: 'ss', æ: 'ae', œ: 'oe', ı: 'i', ё: 'е' };
const LATIN_WITH_MARKS = /[À-ɏḀ-ỿ]/g;

export function searchFold(value: string): string {
  return value
    .toLowerCase()
    .replace(/[łđøßæœıё]/g, (ch) => EXTRA[ch] ?? ch)
    .replace(LATIN_WITH_MARKS, (ch) => ch.normalize('NFD').replace(/\p{M}/gu, ''));
}

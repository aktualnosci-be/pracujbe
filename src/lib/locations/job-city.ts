import { BELGIAN_CITIES, cityKey } from '@/lib/matching/belgian-cities';

/**
 * Kanoniczne miasto oferty w kreatorze (audyt P1-10, migracja 0200). Zapis `jobs.location_id`
 * robi trigger w bazie — tu tylko podpowiedź dla rekrutera: czy wpisana nazwa jest w słowniku
 * miejscowości (`location_aliases`, klucz `cityKey`) i propozycje nazw do listy `datalist`.
 * Wpisany tekst nigdy nie jest podmieniany.
 */

/** Najwięcej propozycji w liście podpowiedzi. */
export const JOB_CITY_SUGGESTION_LIMIT = 8;
/** Od tylu znaków klucza pytamy o propozycje (krótszy prefiks = szum). */
export const JOB_CITY_MIN_PREFIX = 2;

export type JobCityMatch = { slug: string; name: string };

export type JobCityAssist =
  | { status: 'ok'; match: JobCityMatch | null; suggestions: string[] }
  | { status: 'error' };

/** Wzorzec LIKE „zaczyna się od” dla klucza miasta (escape `\ % _`, jak `search_like_pattern`). */
export function cityKeyPrefixPattern(key: string): string {
  return `${key.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * Z aliasów pasujących do prefiksu: jedna propozycja na miejscowość (alias w pisowni rekrutera
 * — `datalist` filtruje po wpisanym tekście), kolejność słownika, bez duplikatów. Alias
 * techniczny (slug małymi literami, np. `charleroi`) zastępuje nazwa miejscowości `name`.
 */
export function pickSuggestions(
  rows: ReadonlyArray<{ locationId: string; alias: string; sortOrder: number; name?: string }>,
  limit = JOB_CITY_SUGGESTION_LIMIT,
): string[] {
  const best = new Map<string, { alias: string; sortOrder: number }>();
  for (const input of rows) {
    const row = input.name && input.alias === input.alias.toLowerCase() && input.name !== input.name.toLowerCase()
      ? { ...input, alias: input.name }
      : input;
    const current = best.get(row.locationId);
    // Nazwa własna przed zapisem technicznym (alias = slug małymi literami), potem krótsza.
    const rank = (a: string) => [a === a.toLowerCase() ? 1 : 0, a.length] as const;
    if (!current) {
      best.set(row.locationId, { alias: row.alias, sortOrder: row.sortOrder });
      continue;
    }
    const [lowerA, lenA] = rank(row.alias);
    const [lowerB, lenB] = rank(current.alias);
    if (lowerA < lowerB || (lowerA === lowerB && lenA < lenB)) {
      best.set(row.locationId, { alias: row.alias, sortOrder: row.sortOrder });
    }
  }
  return [...best.values()]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.alias.localeCompare(b.alias))
    .map((entry) => entry.alias)
    .filter((alias, index, list) => list.indexOf(alias) === index)
    .slice(0, limit);
}

/** Tryb demo (bez bazy): ta sama reguła na liście kanonicznej w kodzie. */
export function demoJobCityAssist(city: string): { slug: string | null; suggestions: string[] } {
  const key = cityKey(city);
  if (!key) return { slug: null, suggestions: [] };
  const exact = BELGIAN_CITIES.find((c) => [c.slug, ...c.aliases].some((a) => cityKey(a) === key));
  const rows = key.length < JOB_CITY_MIN_PREFIX ? [] : BELGIAN_CITIES.flatMap((c, index) =>
    c.aliases.filter((a) => cityKey(a).startsWith(key))
      .map((alias) => ({ locationId: c.slug, alias, sortOrder: index })));
  return { slug: exact?.slug ?? null, suggestions: pickSuggestions(rows) };
}

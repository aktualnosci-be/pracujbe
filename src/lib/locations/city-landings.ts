import type { CoreLocationKey, LocationKey } from '@/lib/jobs';

/**
 * Katalog landingów miast `/praca/miasto/<klucz>` i jedna reguła ich kwalifikacji (#920).
 *
 * Hub `/praca`, strona miasta (metadane i linki „Inne miasta”) i sitemap korzystają WYŁĄCZNIE
 * z tego modułu — dawniej każde z tych miejsc miało własną, stałą listę 10 miast.
 *
 * Katalog to wybrane miejscowości (nie cały słownik `locations`): każda ma nazwę w czterech
 * językach (`locations.*`) i własny opis rynku pracy (`landing.city_<klucz>`), a klucz jest
 * slugiem miejscowości w słowniku (0112). Filtr strony to wszystkie nazwy miasta
 * (`cityAliases`), które baza zamienia na `location_id` gminy razem z jej częściami
 * (`location_filter_ids`, 0153/0183) — jedna strona na gminę, bez osobnych stron dla części.
 *
 * Kwalifikacja: landing jest indeksowany, pokazywany w hubie i zgłaszany w sitemapie dopiero
 * od `CITY_LANDING_MIN_ACTIVE_JOBS` aktualnych ofert. Poniżej progu strona działa dalej jako
 * filtr (`noindex, follow`), ale znika z huba i sitemapy. Liczba ofert miasta nie zależy od
 * języka strony (filtr po wszystkich nazwach), więc wszystkie wersje językowe i hreflang
 * kwalifikują się razem.
 */

/** Pierwsze miasta landingów (dane demonstracyjne; hub bez liczników pokazuje tylko je). */
export const CORE_CITY_LANDING_KEYS: readonly CoreLocationKey[] = [
  'brussels',
  'antwerp',
  'ghent',
  'leuven',
  'mechelen',
  'hasselt',
  'liege',
  'charleroi',
  'bruges',
  'kortrijk',
];

/** Kolejne miejscowości katalogu (#920) — kwalifikują się wyłącznie po liczbie ofert. */
export const ADDITIONAL_CITY_LANDING_KEYS: readonly Exclude<LocationKey, CoreLocationKey>[] = [
  'namur',
  'mons',
  'aalst',
  'ostend',
  'genk',
  'sint-niklaas',
  'roeselare',
  'la-louviere',
  'tournai',
  'turnhout',
  'vilvoorde',
  'zaventem',
  'wavre',
];

/** Pełny katalog w kolejności prezentacji (hub, sitemap, „Inne miasta”). */
export const CITY_LANDING_KEYS: readonly LocationKey[] = [
  ...CORE_CITY_LANDING_KEYS,
  ...ADDITIONAL_CITY_LANDING_KEYS,
];

/**
 * Próg podaży: najmniej tyle aktualnych ofert, żeby landing był indeksowany i linkowany.
 * Jedna wartość dla metadanych, huba i sitemapy.
 */
export const CITY_LANDING_MIN_ACTIVE_JOBS = 3;

export function isCityLandingKey(value: string): value is LocationKey {
  return (CITY_LANDING_KEYS as readonly string[]).includes(value);
}

/** Czy landing z tą liczbą aktualnych ofert się kwalifikuje. Brak liczby = nie. */
export function cityLandingQualifies(count: number | null | undefined): boolean {
  return (
    typeof count === 'number' && Number.isFinite(count) && count >= CITY_LANDING_MIN_ACTIVE_JOBS
  );
}

/**
 * Miasta, które się kwalifikują, w kolejności katalogu. `null` = liczniki nieznane (błąd
 * odczytu, tryb demo, build) — wywołujący decyduje, co pokazać, ale nie może zgadywać.
 */
export function qualifyingCityLandings(
  counts: Partial<Record<LocationKey, number>> | null,
): LocationKey[] | null {
  if (!counts) return null;
  return CITY_LANDING_KEYS.filter((key) => cityLandingQualifies(counts[key]));
}

/**
 * Miasta do linkowania (hub, „Inne miasta”): przy znanych licznikach tylko kwalifikujące się;
 * bez liczników (demo/build/awaria) — rdzeń katalogu jak przed #920, bez kolejnych miejscowości.
 */
export function linkedCityLandings(
  counts: Partial<Record<LocationKey, number>> | null,
): readonly LocationKey[] {
  return qualifyingCityLandings(counts) ?? CORE_CITY_LANDING_KEYS;
}

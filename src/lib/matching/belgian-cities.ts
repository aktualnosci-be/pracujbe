import type { Coordinates } from '@/lib/matching/score';

/**
 * Kanoniczne współrzędne belgijskich miast jako dane w kodzie (#194) — bez geokodowania
 * zewnętrznego. Źródłem prawdy jest słownik `locations` + `location_aliases` w bazie
 * (migracja 0112: te miasta + gminy Belgii z Wikidata, CC0); ta lista jest jego lustrem
 * i zapasem, gdy wiersza w bazie brak. Generator migracji
 * (`scripts/locations/build-migration.mjs`) bierze stąd współrzędne i aliasy tych miast
 * (mają pierwszeństwo przed Wikidata); zgodność pilnuje `matching-locations.test.ts`.
 *
 * Współrzędne = przybliżone centrum miejscowości (jak w `0010`). Aliasy: nazwy PL/NL/FR/EN
 * i warianty bez myślników; porównanie bez wielkości liter i znaków diakrytycznych.
 * Miasto spoza listy i słownika = współrzędne nieznane — silnik wraca do reguły nazw/regionu.
 * Zmiana tej listy = ponowne `node scripts/locations/build-migration.mjs` (nowa migracja,
 * gdy 0112 jest już wdrożona).
 */
export type BelgianCity = {
  slug: string;
  lat: number;
  lng: number;
  aliases: readonly string[];
};

export const BELGIAN_CITIES: readonly BelgianCity[] = [
  // --- te same wartości co `supabase/migrations/0010_seed_dictionaries.sql` ---
  { slug: 'brussels', lat: 50.8503, lng: 4.3517, aliases: ['Brussels', 'Brussel', 'Bruxelles', 'Bruksela'] },
  { slug: 'antwerp', lat: 51.2194, lng: 4.4025, aliases: ['Antwerp', 'Antwerpen', 'Anvers', 'Antwerpia'] },
  { slug: 'ghent', lat: 51.0541, lng: 3.7172, aliases: ['Ghent', 'Gent', 'Gand', 'Gandawa'] },
  { slug: 'leuven', lat: 50.8796, lng: 4.7005, aliases: ['Leuven', 'Louvain'] },
  { slug: 'mechelen', lat: 51.0281, lng: 4.4776, aliases: ['Mechelen', 'Malines'] },
  { slug: 'hasselt', lat: 50.9306, lng: 5.3378, aliases: ['Hasselt'] },
  { slug: 'liege', lat: 50.6326, lng: 5.5797, aliases: ['Liège', 'Luik', 'Lüttich'] },
  { slug: 'charleroi', lat: 50.4113, lng: 4.4445, aliases: ['Charleroi'] },
  { slug: 'bruges', lat: 51.2097, lng: 3.2247, aliases: ['Bruges', 'Brugge', 'Brugia'] },
  { slug: 'kortrijk', lat: 50.8282, lng: 3.2649, aliases: ['Kortrijk', 'Courtrai'] },
  // --- pozostałe miasta (w bazie od 0112) ---
  { slug: 'namur', lat: 50.4674, lng: 4.8718, aliases: ['Namur', 'Namen'] },
  { slug: 'mons', lat: 50.4542, lng: 3.9567, aliases: ['Mons', 'Bergen'] },
  { slug: 'aalst', lat: 50.9378, lng: 4.0403, aliases: ['Aalst', 'Alost'] },
  { slug: 'ostend', lat: 51.2154, lng: 2.9286, aliases: ['Ostend', 'Oostende', 'Ostende', 'Ostenda'] },
  { slug: 'genk', lat: 50.965, lng: 5.5008, aliases: ['Genk'] },
  { slug: 'sint-niklaas', lat: 51.165, lng: 4.1437, aliases: ['Sint-Niklaas'] },
  { slug: 'roeselare', lat: 50.9469, lng: 3.1227, aliases: ['Roeselare', 'Roulers'] },
  { slug: 'la-louviere', lat: 50.4796, lng: 4.1874, aliases: ['La Louvière'] },
  { slug: 'tournai', lat: 50.6056, lng: 3.3878, aliases: ['Tournai', 'Doornik'] },
  { slug: 'verviers', lat: 50.5891, lng: 5.8628, aliases: ['Verviers'] },
  { slug: 'seraing', lat: 50.5986, lng: 5.5122, aliases: ['Seraing'] },
  { slug: 'mouscron', lat: 50.7439, lng: 3.2141, aliases: ['Mouscron', 'Moeskroen'] },
  { slug: 'beveren', lat: 51.2128, lng: 4.2553, aliases: ['Beveren'] },
  { slug: 'dendermonde', lat: 51.0286, lng: 4.101, aliases: ['Dendermonde', 'Termonde'] },
  { slug: 'turnhout', lat: 51.3227, lng: 4.9447, aliases: ['Turnhout'] },
  { slug: 'vilvoorde', lat: 50.9281, lng: 4.429, aliases: ['Vilvoorde', 'Vilvorde'] },
  { slug: 'zaventem', lat: 50.8833, lng: 4.4667, aliases: ['Zaventem'] },
  { slug: 'lokeren', lat: 51.1036, lng: 3.9937, aliases: ['Lokeren'] },
  { slug: 'wavre', lat: 50.717, lng: 4.601, aliases: ['Wavre', 'Waver'] },
  { slug: 'ninove', lat: 50.8285, lng: 4.0254, aliases: ['Ninove'] },
  { slug: 'geel', lat: 51.1614, lng: 4.99, aliases: ['Geel'] },
  { slug: 'halle', lat: 50.7339, lng: 4.2345, aliases: ['Halle', 'Hal'] },
  { slug: 'herentals', lat: 51.1766, lng: 4.8358, aliases: ['Herentals'] },
  { slug: 'lier', lat: 51.1313, lng: 4.5704, aliases: ['Lier', 'Lierre'] },
  { slug: 'sint-truiden', lat: 50.8166, lng: 5.1866, aliases: ['Sint-Truiden', 'Saint-Trond'] },
  { slug: 'tongeren', lat: 50.7806, lng: 5.4641, aliases: ['Tongeren', 'Tongres'] },
  { slug: 'ypres', lat: 50.8503, lng: 2.8853, aliases: ['Ypres', 'Ieper', 'Ypry'] },
  { slug: 'waregem', lat: 50.8886, lng: 3.4271, aliases: ['Waregem'] },
  { slug: 'nivelles', lat: 50.5983, lng: 4.3285, aliases: ['Nivelles', 'Nijvel'] },
  { slug: 'ottignies-louvain-la-neuve', lat: 50.6681, lng: 4.6118, aliases: ['Ottignies-Louvain-la-Neuve', 'Louvain-la-Neuve', 'Ottignies'] },
  { slug: 'knokke-heist', lat: 51.35, lng: 3.2667, aliases: ['Knokke-Heist', 'Knokke'] },
  { slug: 'zeebrugge', lat: 51.3333, lng: 3.2, aliases: ['Zeebrugge', 'Zeebruges'] },
  { slug: 'maasmechelen', lat: 50.9656, lng: 5.6942, aliases: ['Maasmechelen'] },
  { slug: 'lommel', lat: 51.2306, lng: 5.3136, aliases: ['Lommel'] },
  { slug: 'arlon', lat: 49.6833, lng: 5.8167, aliases: ['Arlon', 'Aarlen'] },
  { slug: 'bastogne', lat: 50.0003, lng: 5.7156, aliases: ['Bastogne', 'Bastenaken'] },
];

/** Klucz porównania nazw: bez diakrytyków, małe litery, myślniki i spacje ujednolicone. */
export function cityKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\s-]+/g, ' ')
    .trim();
}

const COORDINATES_BY_KEY = new Map<string, Coordinates>();
for (const city of BELGIAN_CITIES) {
  const coordinates = { lat: city.lat, lng: city.lng };
  for (const name of [city.slug, ...city.aliases]) COORDINATES_BY_KEY.set(cityKey(name), coordinates);
}

/** Współrzędne z kanonicznej listy dla nazwy w dowolnym obsługiwanym języku; brak → undefined. */
export function belgianCityCoordinates(city: string | undefined): Coordinates | undefined {
  if (!city) return undefined;
  const wanted = cityKey(city);
  return wanted ? COORDINATES_BY_KEY.get(wanted) : undefined;
}

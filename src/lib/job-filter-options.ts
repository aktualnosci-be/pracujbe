import { LANGUAGE_CODES, type LanguageCode } from '@/lib/languages';

/**
 * Wartości nowych filtrów listy ofert (migracja 0194 — numer tymczasowy) — moduł czysty, bez
 * Zoda (importują go klienckie panele filtrów, #390). Te same listy sprawdza baza:
 * `get_public_jobs` (`p_language`, `p_language_level`, `p_work_time`, `p_near`, `p_radius_km`)
 * i kanonizacja zapisanych wyszukiwań (`saved_search_canonical_filters`); zgodność pilnuje
 * test `job-filters-0194`.
 */

/** Wymiar czasu pracy oferty (#811, `jobs.work_time`); brak = pracodawca nie podał. */
export const WORK_TIME_VALUES = ['full_time', 'part_time', 'both'] as const;
export type WorkTime = (typeof WORK_TIME_VALUES)[number];

/** Filtr wymiaru pracy: oferta `both` pasuje do obu wartości. */
export const WORK_TIME_FILTERS = ['full_time', 'part_time'] as const;
export type WorkTimeFilter = (typeof WORK_TIME_FILTERS)[number];

export function isWorkTime(value: unknown): value is WorkTime {
  return typeof value === 'string' && (WORK_TIME_VALUES as readonly string[]).includes(value);
}

export function isWorkTimeFilter(value: unknown): value is WorkTimeFilter {
  return typeof value === 'string' && (WORK_TIME_FILTERS as readonly string[]).includes(value);
}

/** Czy wymiar oferty pasuje do filtra — lustro warunku SQL (`work_time in (p_work_time, 'both')`). */
export function workTimeMatches(job: WorkTime | undefined, filter: WorkTimeFilter): boolean {
  return job === filter || job === 'both';
}

/**
 * Poziomy wymaganego języka (enum `language_level`, rosnąco). Filtr = poziom kandydata:
 * pasuje wymaganie na poziomie najwyżej wybranym albo bez poziomu (#786).
 */
export const LANGUAGE_FILTER_LEVELS = ['basic', 'intermediate', 'fluent', 'native'] as const;
export type LanguageFilterLevel = (typeof LANGUAGE_FILTER_LEVELS)[number];

export function isLanguageFilterLevel(value: unknown): value is LanguageFilterLevel {
  return typeof value === 'string' && (LANGUAGE_FILTER_LEVELS as readonly string[]).includes(value);
}

/** Wymaganie spełnione przez poziom kandydata — lustro `job_requires_language` (0194). */
export function languageLevelSatisfies(
  required: LanguageFilterLevel | null | undefined,
  candidate: LanguageFilterLevel | undefined,
): boolean {
  if (!candidate || !required) return true;
  return LANGUAGE_FILTER_LEVELS.indexOf(required) <= LANGUAGE_FILTER_LEVELS.indexOf(candidate);
}

/** Języki do wyboru w filtrze = słownik `public.languages` (kody ISO). */
export const LANGUAGE_FILTER_CODES: readonly LanguageCode[] = LANGUAGE_CODES;

export function isLanguageFilterCode(value: unknown): value is LanguageCode {
  return typeof value === 'string' && (LANGUAGE_FILTER_CODES as readonly string[]).includes(value);
}

/** Promień od miejscowości (#824) — lista wartości w UI i w zapisanych wyszukiwaniach. */
export const RADIUS_KM_OPTIONS = [5, 10, 25, 50, 100] as const;
export type RadiusKm = (typeof RADIUS_KM_OPTIONS)[number];
export const DEFAULT_RADIUS_KM: RadiusKm = 25;

export function parseRadiusKm(value: string | undefined): RadiusKm {
  const n = value ? Number(value) : Number.NaN;
  return (RADIUS_KM_OPTIONS as readonly number[]).includes(n) ? (n as RadiusKm) : DEFAULT_RADIUS_KM;
}

/** Limit długości nazwy miejscowości promienia (jak `left(p_near, 100)` w SQL). */
export const NEAR_MAX_LENGTH = 100;

/** Promień Ziemi jak w `geo_distance_km` (0194). */
const EARTH_RADIUS_KM = 6371;

/** Odległość po łuku koła wielkiego (haversine) — lustro `geo_distance_km` dla danych demo. */
export function distanceKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

type GeoPoint = { lat: number; lng: number };

/**
 * #824 — czy oferta mieści się w filtrze promienia (lustro SQL 0194). Oferta zdalna pasuje do
 * KAŻDEGO promienia — także przy nierozpoznanej miejscowości środka (decyzja właściciela
 * 29.09.2026: dojazd nie dotyczy pracy zdalnej). Inaczej odległość tylko ze znanych
 * współrzędnych obu miejsc; nieznane = nie pasuje (nie zgadujemy).
 */
export function jobWithinRadius(
  job: { remote?: boolean; point: GeoPoint | undefined },
  center: GeoPoint | undefined,
  radiusKm: number,
): boolean {
  if (job.remote === true) return true;
  return Boolean(center && job.point && distanceKm(center, job.point) <= radiusKm);
}

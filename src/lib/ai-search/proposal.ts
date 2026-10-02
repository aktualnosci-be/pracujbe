import {
  parseLocationsParam,
  serializeLocations,
  splitParam,
} from '@/components/public/job-filters';
import type { JobFilterSummaryItem } from '@/lib/job-filter-summary';

/**
 * Propozycja filtrów z wyszukiwania opisem (#711) — kontrakt między akcją serwera a formularzem
 * w przeglądarce. Moduł czysty (bez I/O, bez słowników), więc może trafić do bundla klienta.
 *
 * `params` = KANONICZNE parametry listy `/oferty-pracy` (te same, które zapisuje sidebar
 * i czyta `parseJobListQuery`). Nic nie jest stosowane automatycznie: lista zmienia się dopiero
 * po kliknięciu „Zastosuj filtry”, a użytkownik może wcześniej odznaczyć każdy filtr i wybrać
 * nierozpoznaną miejscowość jako wyszukiwanie tekstowe (domyślnie żadną).
 */

export interface JobSearchProposal {
  /** Wersja kontraktu odpowiedzi modelu (audyt, `SEARCH_ASSIST_SCHEMA_VERSION`). */
  schemaVersion: string;
  /** Model, który przygotował propozycję (`fixture` dla atrapy). */
  model: string;
  params: Record<string, string>;
  /** Filtry do pokazania (etykiety w języku interfejsu) — po jednym na wartość. */
  items: JobFilterSummaryItem[];
  /** Fragmenty tekstu użytkownika wyglądające na miejscowość spoza słownika — do wyboru. */
  places: string[];
  /** Fragmenty tekstu użytkownika, których nie przypisano do żadnego filtra. */
  uncertain: string[];
  /** Liczba wartości odrzuconych przez serwer (spoza słownika, spoza tekstu użytkownika). */
  droppedCount: number;
}

const BASE_PATH = '/oferty-pracy';

/** Usuwa z parametrów jeden filtr — ta sama reguła co link „Usuń filtr” na liście ofert. */
export function withoutFilterItem(
  params: Readonly<Record<string, string>>,
  item: Pick<JobFilterSummaryItem, 'removeKey' | 'removeValue' | 'alsoRemove'>,
): Record<string, string> {
  const next = { ...params };
  if (item.removeKey === 'salary') {
    delete next['salaryMin'];
    delete next['salaryMax'];
    delete next['salaryUnit'];
    return next;
  }
  if (item.removeValue !== undefined) {
    const key = item.removeKey;
    // Lokalizacja może zawierać przecinek (#845) — osobna, escapująca para funkcji.
    const rest =
      key === 'location'
        ? parseLocationsParam(next[key]).filter((v) => v !== item.removeValue)
        : splitParam(next[key]).filter((v) => v !== item.removeValue);
    if (rest.length) next[key] = key === 'location' ? serializeLocations(rest) : rest.join(',');
    else delete next[key];
    return next;
  }
  delete next[item.removeKey];
  for (const extra of item.alsoRemove ?? []) delete next[extra];
  return next;
}

/**
 * Parametry po decyzjach użytkownika: bez odznaczonych filtrów, z wybraną miejscowością jako
 * wyszukiwaniem tekstowym (`city`) tylko wtedy, gdy pochodzi z listy `places`.
 */
export function selectedProposalParams(
  proposal: Pick<JobSearchProposal, 'params' | 'items' | 'places'>,
  deselected: ReadonlySet<string>,
  place: string | null,
): Record<string, string> {
  let params: Record<string, string> = { ...proposal.params };
  for (const item of proposal.items) {
    if (deselected.has(item.id)) params = withoutFilterItem(params, item);
  }
  if (place !== null && proposal.places.includes(place)) params['city'] = place;
  return params;
}

/** Adres listy ofert (bez prefiksu języka — dokłada go nawigacja next-intl). */
export function proposalHref(params: Readonly<Record<string, string>>): string {
  const qs = new URLSearchParams(params).toString();
  return qs ? `${BASE_PATH}?${qs}` : BASE_PATH;
}

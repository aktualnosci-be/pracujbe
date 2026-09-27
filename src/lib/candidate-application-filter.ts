/**
 * Filtr etapu na liście „Moje zgłoszenia” kandydata (#809).
 *
 * Wartość filtra jest w URL (`?etap=`), a serwer filtruje PRZED limitem strony i kursorem,
 * więc starsze zgłoszenie wybranego etapu trafia na pierwszą stronę mimo wielu nowszych.
 * Bez filtra (albo z nieznaną wartością) lista pokazuje wszystkie zgłoszenia.
 */

/** Wszystkie wartości enuma `application_status` (0001). */
export const APPLICATION_STATUSES = [
  'draft',
  'submitted',
  'viewed',
  'shortlisted',
  'interview',
  'offer_sent',
  'offer_accepted',
  'offer_declined',
  'rejected',
  'withdrawn',
  'hired',
] as const;

export type ApplicationStatusValue = (typeof APPLICATION_STATUSES)[number];

/** Kolejność = kolejność przycisków filtra. Wartości to fragment adresu (`?etap=`). */
export const APPLICATION_FILTERS = ['aktywne', 'rozmowa', 'propozycja', 'zakonczone'] as const;

export type ApplicationFilter = (typeof APPLICATION_FILTERS)[number];

/** Parametr adresu niosący filtr. */
export const APPLICATION_FILTER_PARAM = 'etap';

/**
 * Statusy każdego etapu. Grupy są rozłączne i razem obejmują każdy status poza `draft`
 * (kandydat nie ma szkiców zgłoszeń — widać je tylko w „Wszystkie”); pilnuje tego test.
 */
export const APPLICATION_FILTER_STATUSES: Readonly<Record<ApplicationFilter, readonly ApplicationStatusValue[]>> = {
  aktywne: ['submitted', 'viewed', 'shortlisted'],
  rozmowa: ['interview'],
  propozycja: ['offer_sent', 'offer_accepted'],
  zakonczone: ['hired', 'offer_declined', 'rejected', 'withdrawn'],
};

/** Klucze etykiet w `dashboard.*` (src/messages). */
export const APPLICATION_FILTER_LABEL_KEYS = {
  aktywne: 'applicationsFilterActive',
  rozmowa: 'applicationsFilterInterview',
  propozycja: 'applicationsFilterOffer',
  zakonczone: 'applicationsFilterClosed',
} as const satisfies Record<ApplicationFilter, string>;

export function isApplicationFilter(value: unknown): value is ApplicationFilter {
  return typeof value === 'string' && (APPLICATION_FILTERS as readonly string[]).includes(value);
}

/** Wartość z `searchParams`: pierwsza, jeśli parametr powtórzono; nieznana = brak filtra. */
export function parseApplicationFilter(value: string | string[] | undefined): ApplicationFilter | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return isApplicationFilter(raw) ? raw : null;
}

/** Statusy do warunku SQL; `null` = bez warunku (wszystkie zgłoszenia). */
export function applicationFilterStatuses(filter: ApplicationFilter | null): readonly ApplicationStatusValue[] | null {
  return filter ? APPLICATION_FILTER_STATUSES[filter] : null;
}

/** Czy status należy do etapu (lustro warunku SQL — demo i fixture bez bazy). */
export function matchesApplicationFilter(status: string, filter: ApplicationFilter | null): boolean {
  const statuses = applicationFilterStatuses(filter);
  return statuses === null || (statuses as readonly string[]).includes(status);
}

/** Adres listy z filtrem (względny do locale; `Link` z next-intl dokłada prefiks). */
export function applicationFilterHref(filter: ApplicationFilter | null): string {
  return filter ? `/candidate/aplikacje?${APPLICATION_FILTER_PARAM}=${filter}` : '/candidate/aplikacje';
}

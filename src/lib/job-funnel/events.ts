/**
 * Zdarzenia serwerowego lejka ofert (#99). Moduł bez zależności (także bez Zoda) — importują
 * go wyspa kliencka strony oferty i endpoint `/api/job-funnel`.
 *
 * Definicje metryk (te same w migracji 0089 i w panelu statystyk):
 * - `search_appearance` — oferta pokazana w wynikach listy ofert (jedno żądanie na widok listy);
 * - `detail_view` — wyświetlenie strony szczegółu oferty;
 * - `apply_started` — otwarcie formularza „Aplikuj” na stronie oferty (raz na wyświetlenie);
 * - wysłane aplikacje nie są zdarzeniem: liczy je baza ze stanu `applications`.
 */
export const FUNNEL_EVENTS = ['search_appearance', 'detail_view', 'apply_started'] as const;
export type FunnelEvent = (typeof FUNNEL_EVENTS)[number];

/** Limit ofert w jednym zdarzeniu (lista ofert = jedna strona wyników). Równy limitowi w 0089. */
export const FUNNEL_MAX_JOBS: Record<FunnelEvent, number> = {
  search_appearance: 50,
  detail_view: 1,
  apply_started: 1,
};

/** Adres endpointu zliczającego. */
export const FUNNEL_ENDPOINT = '/api/job-funnel';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

export function isFunnelEvent(value: unknown): value is FunnelEvent {
  return typeof value === 'string' && (FUNNEL_EVENTS as readonly string[]).includes(value);
}

export interface FunnelPayload {
  event: FunnelEvent;
  /** Losowy identyfikator jednego załadowania widoku — klucz deduplikacji retry. */
  nonce: string;
  jobIds: string[];
}

/**
 * Walidacja body endpointu. Zwraca `null` dla każdego odstępstwa — endpoint nie tłumaczy
 * przyczyny (brak technikaliów, Invariant #8). Duplikaty ofert są usuwane.
 */
export function parseFunnelPayload(input: unknown): FunnelPayload | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.some((key) => key !== 'event' && key !== 'nonce' && key !== 'jobIds')) return null;
  const { event, nonce, jobIds } = record;
  if (!isFunnelEvent(event) || !isUuid(nonce) || !Array.isArray(jobIds)) return null;
  if (jobIds.length === 0 || jobIds.length > FUNNEL_MAX_JOBS[event]) return null;
  if (!jobIds.every(isUuid)) return null;
  return {
    event,
    nonce: nonce.toLowerCase(),
    jobIds: [...new Set(jobIds.map((id) => id.toLowerCase()))],
  };
}

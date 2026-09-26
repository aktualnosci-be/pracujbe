import { allowsTrackingOnPath } from '@/lib/analytics/route-policy';
import { CONSENT_CHANGE_EVENT, getConsent, type ConsentRecord } from '@/lib/consent-cookie';

import { FUNNEL_ENDPOINT, type FunnelEvent } from './events';

/**
 * Klient serwerowego lejka ofert (#99). Bez cookies (`credentials: 'omit'`), bez zapisu w storage
 * (poza znacznikiem wyłączenia dla konta 16–17, #576),
 * bez identyfikatorów: jedyną wartością spoza treści strony jest losowy nonce jednego
 * załadowania widoku, trzymany w pamięci karty (znika po odświeżeniu/zamknięciu).
 * Błędy sieci są ignorowane — pomiar nie może wpływać na stronę i nie jest ponawiany.
 *
 * #575 (decyzja właściciela, ePrivacy): zdarzenie wychodzi WYŁĄCZNIE po zgodzie w kategorii
 * `analytics` banera cookies. Zgoda jest czytana z cookie w chwili wysyłki — także odmowa albo
 * wycofanie w innej karcie i zgoda zapisana przed restartem przeglądarki. Wyświetlenie przed
 * decyzją czeka w pamięci karty (`whenFunnelConsent`); odmowa lub wycofanie czyści kolejkę.
 * `apply_started` bez zgody nie jest kolejkowane.
 */

export type FunnelConsentState = 'granted' | 'denied' | 'undecided';

/** Stan zgody na lejek: kategoria analityczna na stronie, na której wolno mierzyć. */
export function funnelConsentState(record: ConsentRecord | null = getConsent()): FunnelConsentState {
  if (typeof window === 'undefined') return 'denied';
  if (!allowsTrackingOnPath(window.location.pathname)) return 'denied';
  if (!record) return 'undecided';
  return record.categories.analytics === true ? 'granted' : 'denied';
}

/** Zdarzenia czekające na decyzję w banerze (tylko pamięć karty). */
const pending = new Set<() => void>();
let listening = false;

function onConsentChange(): void {
  const state = funnelConsentState();
  if (state === 'undecided') return;
  const queued = [...pending];
  pending.clear();
  if (state === 'granted') for (const callback of queued) callback();
}

function listenForConsent(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener(CONSENT_CHANGE_EVENT, onConsentChange);
}

/**
 * Uruchamia `callback`, gdy lejek ma zgodę: od razu przy zgodzie, nigdy przy odmowie, a przed
 * decyzją — po zgodzie udzielonej w tej karcie. Zwraca anulowanie (np. odmontowanie widoku).
 */
export function whenFunnelConsent(callback: () => void): () => void {
  const state = funnelConsentState();
  if (state === 'granted') {
    callback();
    return () => undefined;
  }
  if (state === 'denied') return () => undefined;
  pending.add(callback);
  listenForConsent();
  return () => {
    pending.delete(callback);
  };
}

/** Liczba zdarzeń czekających na zgodę (do testów). */
export function pendingFunnelEventCount(): number {
  return pending.size;
}

/**
 * Konto 16–17 lat (#576, LAUNCH-1): lejek traktujemy jak brak zgody — na urządzeniu znanej
 * osoby niepełnoletniej nic nie wysyłamy. Zdarzenia lejka nie niosą tożsamości (strony ISR,
 * `credentials: 'omit'`), więc znacznik zostawia panel kandydata po odczycie deklaracji
 * wieku z bazy oraz formularz rejestracji/aplikacji gościa po wyborze przedziału 16–17.
 * Znacznik działa tylko w stronę „wyłącz” (brak znacznika = dotychczasowe zachowanie);
 * zdejmuje go dopiero potwierdzenie 18+ na tym urządzeniu. Brak dostępu do storage →
 * pomiar pomijamy (bezpieczniej nie wysłać niż wysłać danych osoby niepełnoletniej).
 */
export const FUNNEL_MINOR_STORAGE_KEY = 'pracujbe.funnel.minor';

export function setKnownMinorDevice(minor: boolean): void {
  try {
    if (minor) window.localStorage.setItem(FUNNEL_MINOR_STORAGE_KEY, '1');
    else window.localStorage.removeItem(FUNNEL_MINOR_STORAGE_KEY);
  } catch {
    // Storage zablokowany — nic nie zapisujemy.
  }
}

export function isKnownMinorDevice(): boolean {
  try {
    return window.localStorage.getItem(FUNNEL_MINOR_STORAGE_KEY) === '1';
  } catch {
    return true;
  }
}

/** Nonce bieżącego wyświetlenia szczegółu per oferta — wspólny dla obu przycisków „Aplikuj”. */
const detailViewNonces = new Map<string, string>();

export function newFunnelNonce(): string {
  return crypto.randomUUID();
}

export function sendFunnelEvent(event: FunnelEvent, jobIds: readonly string[], nonce: string): void {
  if (jobIds.length === 0) return;
  if (isKnownMinorDevice()) return;
  // Ostatnia bramka: zgoda sprawdzana tuż przed wysyłką (także wycofana w innej karcie).
  if (funnelConsentState() !== 'granted') return;
  try {
    void fetch(FUNNEL_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, nonce, jobIds }),
      credentials: 'omit',
      cache: 'no-store',
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Przeglądarka bez fetch/keepalive — pomijamy pomiar.
  }
}

/** Wysyła po tym, jak strona jest faktycznie widoczna (nie w prerenderze ani w tle). */
export function whenPageVisible(callback: () => void): () => void {
  const doc = document as Document & { prerendering?: boolean };
  const ready = () => !doc.prerendering && doc.visibilityState === 'visible';
  if (ready()) {
    callback();
    return () => undefined;
  }
  let done = false;
  const check = () => {
    if (done || !ready()) return;
    done = true;
    cleanup();
    callback();
  };
  const cleanup = () => {
    document.removeEventListener('visibilitychange', check);
    document.removeEventListener('prerenderingchange', check);
  };
  document.addEventListener('visibilitychange', check);
  document.addEventListener('prerenderingchange', check);
  return () => {
    done = true;
    cleanup();
  };
}

export function beginDetailView(jobId: string, nonce: string): void {
  detailViewNonces.set(jobId, nonce);
}

/** Otwarcie formularza „Aplikuj”: raz na wyświetlenie oferty (deduplikacja po nonce w bazie). */
export function reportApplyStarted(jobId: string): void {
  let nonce = detailViewNonces.get(jobId);
  if (!nonce) {
    nonce = newFunnelNonce();
    detailViewNonces.set(jobId, nonce);
  }
  sendFunnelEvent('apply_started', [jobId], nonce);
}

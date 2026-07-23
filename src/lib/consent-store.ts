/**
 * Lekki store zgód dla komponentów klienckich.
 *
 * Zapewnia luźne sprzężenie między:
 *  - banerem/panelem (@/components/cookies/CookieConsent), który zapisuje zgodę,
 *  - modułem analityki (@/components/cookies/Analytics), który reaguje na zmianę BEZ reloadu,
 *  - przyciskami ponownego otwarcia ustawień (footer / CookieSettingsButton).
 *
 * Komunikacja jest dwutorowa: bezpośredni pub/sub (subscribeConsent) dla komponentów Reacta
 * w tym samym drzewie oraz globalne zdarzenia DOM (`window`) dla elementów spoza drzewa
 * (np. przycisk w stopce zamontowany niezależnie). Wszystkie odwołania do `window` są strażowane,
 * więc moduł jest bezpieczny przy renderze serwerowym.
 */

import {
  getConsent,
  saveConsent,
  type ConsentCategories,
  type ConsentRecord,
} from './consent';

/** Zdarzenie DOM emitowane po zmianie zgody (detail: ConsentRecord). */
export const CONSENT_CHANGE_EVENT = 'pracujbe:consent-change';

/**
 * Zdarzenie DOM proszące o otwarcie panelu ustawień cookies.
 * Ta sama nazwa, której używa @/components/layout/CookieSettingsButton w stopce —
 * CookieConsent nasłuchuje jej i otwiera Dialog.
 */
export const OPEN_SETTINGS_EVENT = 'pracujbe:open-cookie-settings';

type ConsentListener = (record: ConsentRecord | null) => void;

const listeners = new Set<ConsentListener>();

/** Bieżący stan zgody (odczyt z cookie). Null na serwerze i przed zgodą. */
export function getConsentSnapshot(): ConsentRecord | null {
  return getConsent();
}

/** Subskrypcja zmian zgody. Zwraca funkcję odsubskrybowania. */
export function subscribeConsent(listener: ConsentListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Zapis nowej zgody + rozgłoszenie zmiany do subskrybentów i przez zdarzenie DOM.
 * To jedyna droga zmiany zgody używana przez UI (baner i panel).
 */
export function updateConsent(categories: ConsentCategories): ConsentRecord {
  const record = saveConsent(categories);
  for (const listener of listeners) {
    listener(record);
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<ConsentRecord>(CONSENT_CHANGE_EVENT, { detail: record }));
  }
  return record;
}

/** Prośba o otwarcie panelu ustawień (np. z przycisku w stopce). */
export function openCookieSettings(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_EVENT));
  }
}

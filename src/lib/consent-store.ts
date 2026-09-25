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
  type ConsentSource,
} from './consent';
import { CONSENT_CHANGE_EVENT } from './consent-cookie';

/**
 * Prefiksy cookies dawnych trackerów (GA, Meta Pixel — usunięte w #570). Nic ich już nie
 * ustawia; pozostałości z wcześniejszych wizyt są usuwane przy każdej synchronizacji zgody.
 */
const LEGACY_TRACKER_COOKIE_PREFIXES = ['_ga', '_gid', '_gat', '_fbp', '_fbc'] as const;

/** Zdarzenie DOM emitowane po zmianie zgody (detail: ConsentRecord) — definicja w consent-cookie. */
export { CONSENT_CHANGE_EVENT };

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
 *
 * Natychmiast egzekwuje bieżący stan (`syncTrackers`), zanim React ponownie wyrenderuje drzewo.
 * Beacon Cloudflare (#570) po wycofaniu blokuje bramka wysyłki (`installCloudflareBeaconGuard`),
 * a lejek ofert (#575) czyta zgodę tuż przed wysyłką.
 */
export function updateConsent(
  categories: ConsentCategories,
  source: ConsentSource = 'cookie_banner',
): ConsentRecord {
  const record = saveConsent(categories, source);
  syncTrackers({ analytics: record.categories.analytics === true });
  for (const listener of listeners) {
    listener(record);
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<ConsentRecord>(CONSENT_CHANGE_EVENT, { detail: record }));
  }
  return record;
}

/** Flagi zgody istotne dla statystyki. */
export interface TrackerConsent {
  analytics: boolean;
}

/**
 * Egzekwuje bieżący stan zgody (wołane z `updateConsent` i z <Analytics/>). Idempotentne
 * i bezpieczne na serwerze. Od #570 jedyną statystyką jest beacon Cloudflare bez cookies —
 * tu zostało usuwanie cookies dawnych trackerów GA/Meta z wcześniejszych wizyt (niezależnie
 * od zgody: żadna kategoria ich już nie potrzebuje). Parametr zostaje dla czytelności wywołań.
 */
export function syncTrackers(_consent: TrackerConsent): void {
  if (typeof window === 'undefined') return;
  clearCookiesByPrefix(LEGACY_TRACKER_COOKIE_PREFIXES);
}

/** Usuwa wszystkie cookies o podanych prefiksach (ścieżka `/`, host oraz domena bazowa). */
function clearCookiesByPrefix(prefixes: readonly string[]): void {
  if (typeof document === 'undefined') return;

  const names = document.cookie
    .split('; ')
    .map((entry) => entry.split('=')[0])
    .filter((name): name is string => {
      if (!name) return false;
      return prefixes.some((prefix) => name.startsWith(prefix));
    });
  if (names.length === 0) return;

  const host = typeof location !== 'undefined' ? location.hostname : '';
  const domains = domainVariants(host);

  for (const name of names) {
    document.cookie = `${name}=; Max-Age=0; Path=/`;
    for (const domain of domains) {
      document.cookie = `${name}=; Max-Age=0; Path=/; Domain=${domain}`;
    }
  }
}

/** Warianty domeny do skasowania cookie (GA ustawia je zwykle na domenie bazowej z kropką). */
function domainVariants(host: string): string[] {
  if (!host || host === 'localhost') return [];
  const variants = new Set<string>([host, `.${host}`]);
  const parts = host.split('.');
  if (parts.length >= 2) {
    const base = parts.slice(-2).join('.');
    variants.add(base);
    variants.add(`.${base}`);
  }
  return Array.from(variants);
}

/** Prośba o otwarcie panelu ustawień (np. z przycisku w stopce). */
export function openCookieSettings(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_EVENT));
  }
}

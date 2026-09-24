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

/** Measurement ID GA (publiczny, wstrzykiwany do bundle klienta). */
const GA_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

/** Prefiksy cookies ustawianych przez trackery — usuwane po wycofaniu zgody. */
const GA_COOKIE_PREFIXES = ['_ga', '_gid', '_gat'] as const;
const META_COOKIE_PREFIXES = ['_fbp', '_fbc'] as const;

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
 *
 * Natychmiast egzekwuje bieżący stan na poziomie samych trackerów (`syncTrackers`) — nie tylko
 * przez (nie)renderowanie skryptów w <Analytics/>. Dzięki temu wycofanie zgody realnie wyłącza
 * GA/Meta i czyści ich cookies, zanim jeszcze React zdąży ponownie wyrenderować drzewo.
 */
export function updateConsent(
  categories: ConsentCategories,
  source: ConsentSource = 'cookie_banner',
): ConsentRecord {
  const record = saveConsent(categories, source);
  syncTrackers({
    analytics: record.categories.analytics === true,
    marketing: record.categories.marketing === true,
  });
  for (const listener of listeners) {
    listener(record);
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<ConsentRecord>(CONSENT_CHANGE_EVENT, { detail: record }));
  }
  return record;
}

/** Flagi zgody istotne dla trackerów. */
export interface TrackerConsent {
  analytics: boolean;
  marketing: boolean;
}

/**
 * Egzekwuje bieżący stan zgody na poziomie trackerów (skuteczne WYCOFANIE, nie tylko usunięcie
 * tagu <Script>). Wołane z `updateConsent` (przy zmianie) oraz z <Analytics/> (przy montażu
 * i zmianie stanu). Idempotentne i bezpieczne na serwerze (strażowane `window`/`document`).
 *
 * - analytics WYŁĄCZONE → `window['ga-disable-<ID>']=true` (GA respektuje to nawet po załadowaniu)
 *   + usunięcie cookies `_ga*`; analytics WŁĄCZONE → flaga = false (ponowne włączenie po re-zgodzie).
 * - marketing WYŁĄCZONE → `fbq('consent','revoke')` (jeśli obecne) + usunięcie cookies `_fbp`/`_fbc`;
 *   marketing WŁĄCZONE → `fbq('consent','grant')` (jeśli obecne — ponowna zgoda po wycofaniu).
 *
 * Invariant #7 (zero trackingu przed zgodą): gdy kategoria nie jest przyznana, flaga blokująca
 * jest ustawiona, a cookies wyczyszczone; skrypty i tak nie są renderowane przez <Analytics/>.
 */
export function syncTrackers({ analytics, marketing }: TrackerConsent): void {
  if (typeof window === 'undefined') return;

  const w = window as unknown as Record<string, unknown> & {
    fbq?: (...args: unknown[]) => void;
  };

  // --- Google Analytics ---
  if (GA_ID) {
    // Flaga odwoływalna w obie strony: !analytics blokuje, analytics=true odblokowuje.
    w[`ga-disable-${GA_ID}`] = !analytics;
  }
  if (!analytics) {
    clearCookiesByPrefix(GA_COOKIE_PREFIXES);
  }

  // --- Meta Pixel ---
  if (marketing) {
    // Pixel załadowany wcześniej i odwołany (`revoke`) nie wznawia się sam — ponowna zgoda
    // w tej samej sesji strony musi go jawnie przywrócić.
    if (typeof w.fbq === 'function') {
      try {
        w.fbq('consent', 'grant');
      } catch {
        // pixel w trakcie inicjalizacji — ignorujemy
      }
    }
  } else {
    if (typeof w.fbq === 'function') {
      try {
        w.fbq('consent', 'revoke');
      } catch {
        // pixel w trakcie inicjalizacji — ignorujemy
      }
    }
    clearCookiesByPrefix(META_COOKIE_PREFIXES);
  }
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

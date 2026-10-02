'use client';

import { useEffect, useRef, useState } from 'react';
import Script from 'next/script';
import { usePathname } from 'next/navigation';
import { getConsent, pendingConsentPersistence, type ConsentRecord } from '@/lib/consent';
import { subscribeConsent } from '@/lib/consent-store';
import { allowsTrackingOnPath } from '@/lib/analytics/route-policy';
import { cfBeaconConfig, needsHardNavigation, sameOriginTarget } from '@/lib/analytics/beacon';
import { withdrawLoadedBeacon } from '@/lib/analytics/withdraw';

/**
 * Ładowanie skryptu analityki — WYŁĄCZNIE po świadomej zgodzie (#570: Cloudflare Web Analytics
 * zamiast Google Analytics i Meta Pixel — decyzja właściciela 2026-09-25).
 *
 * ZERO trackingu przed zgodą: dopóki użytkownik nie zaakceptuje kategorii `analytics`, beacon
 * się nie renderuje. Komponent czyta bieżącą zgodę przy montażu i reaguje na jej zmiany przez
 * consent-store (bez reloadu) — wycofanie zgody zatrzymuje KOLEJNE wstawienia beaconu od razu
 * i gwarantuje brak beaconu po odświeżeniu (`getConsent()` znów zwróci `null`/`analytics:false`).
 *
 * Cloudflare Web Analytics jest bezcookie'owe (beacon nie ustawia żadnych cookies) i nie ma
 * API do „odwołania" zgody w locie; `next/script` wstawia znacznik `<script>` bezpośrednio do
 * DOM i nie usuwa go (ani jego nasłuchów) przy odmontowaniu komponentu. Dlatego wycofanie zgody,
 * gdy skrypt jest już w karcie (#642), od razu odcina ruch do dostawcy w bieżącym dokumencie
 * i przeładowuje stronę (`withdrawLoadedBeacon`) — po przeładowaniu skryptu nie ma, a
 * `AnalyticsWithdrawnNotice` mówi użytkownikowi, dlaczego strona się odświeżyła.
 *
 * Kategorii `marketing` nie ma (decyzja właściciela 2026-09-25): portal nie używa trackerów
 * marketingowych, a wersja polityki cookies poszła w górę (`CONSENT_POLICY_VERSION`).
 *
 * Nawigacje SPA (#1046, Invariant #7): beacon dostaje `spa: false` (liczy tylko pełne załadowania),
 * a gdy skrypt jest już w karcie, przejście na trasę prywatną (link albo `router.push`) jest
 * pełnym przeładowaniem — nowy dokument nie ma skryptu, więc adresy paneli i jednorazowych
 * linków nie trafiają do dostawcy.
 *
 * Token pochodzi z env `NEXT_PUBLIC_CF_WEB_ANALYTICS_TOKEN`; brak tokenu = nic się nie ładuje.
 */

// Pusty/biały znak = brak tokenu (spójnie z CSP w next.config.mjs).
const CF_ANALYTICS_TOKEN = process.env.NEXT_PUBLIC_CF_WEB_ANALYTICS_TOKEN?.trim() || undefined;

export function Analytics() {
  const [record, setRecord] = useState<ConsentRecord | null>(null);
  const pathname = usePathname();
  const routeAllowed = allowsTrackingOnPath(pathname);

  // Skrypt wstawiony do DOM zostaje do końca dokumentu (`next/script` go nie usuwa).
  const beaconLoaded = useRef(false);

  useEffect(() => {
    // Stan początkowy z cookie (np. zgoda z poprzedniej wizyty) + subskrypcja zmian.
    setRecord(getConsent());
    return subscribeConsent((next) => {
      setRecord(next);
      // #642: wycofanie zgody przy załadowanym beaconie — odcięcie ruchu i przeładowanie.
      if (beaconLoaded.current && next?.categories.analytics !== true) {
        void withdrawLoadedBeacon(pendingConsentPersistence());
      }
    });
  }, []);

  const analyticsGranted = routeAllowed && record?.categories.analytics === true;
  const shouldLoad = analyticsGranted && Boolean(CF_ANALYTICS_TOKEN);

  if (shouldLoad) beaconLoaded.current = true;

  useEffect(() => {
    // Kliknięcie linku na trasę prywatną: pełne przejście ZANIM zmieni się adres w karcie.
    const onClick = (event: MouseEvent) => {
      if (!beaconLoaded.current || event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.('a[href]');
      if (!(anchor instanceof HTMLAnchorElement)) return;
      const target = sameOriginTarget(anchor, window.location.origin);
      if (!target || !needsHardNavigation(true, target.pathname)) return;
      event.preventDefault();
      window.location.assign(target.href);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  useEffect(() => {
    // Przejście programowe (`router.push`, przekierowanie po akcji) na trasę prywatną.
    if (needsHardNavigation(beaconLoaded.current, pathname)) window.location.reload();
  }, [pathname]);

  if (!shouldLoad || !CF_ANALYTICS_TOKEN) return null;

  return (
    <Script
      id="cf-web-analytics"
      src="https://static.cloudflareinsights.com/beacon.min.js"
      data-cf-beacon={cfBeaconConfig(CF_ANALYTICS_TOKEN)}
      strategy="afterInteractive"
    />
  );
}

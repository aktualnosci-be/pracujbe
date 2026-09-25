'use client';

import { useEffect, useState } from 'react';
import Script from 'next/script';
import { usePathname } from 'next/navigation';
import { getConsent, type ConsentRecord } from '@/lib/consent';
import { subscribeConsent, syncTrackers } from '@/lib/consent-store';
import { allowsTrackingOnPath } from '@/lib/analytics/route-policy';
import {
  CF_BEACON_SRC,
  cloudflareAnalyticsToken,
  cloudflareBeaconConfig,
  installCloudflareBeaconGuard,
} from '@/lib/analytics/cloudflare';

/**
 * Statystyka odwiedzin — Cloudflare Web Analytics (#570), WYŁĄCZNIE po zgodzie analitycznej.
 *
 * Google Analytics i Meta Pixel zostały usunięte (decyzja właściciela 25.09.2026). Beacon
 * Cloudflare nie ustawia cookies ani identyfikatorów; mimo to dopóki użytkownik nie zgodzi się
 * na kategorię `analytics`, żaden <Script> nie jest renderowany (Invariant #7). Przed pierwszym
 * załadowaniem instalujemy bramkę wysyłki (`installCloudflareBeaconGuard`) — po wycofaniu zgody
 * (także w innej karcie) załadowany już skrypt nic nie wyśle.
 *
 * Token z `NEXT_PUBLIC_CF_ANALYTICS_TOKEN`; brak tokenu = nic się nie ładuje. Trasy prywatne
 * (`allowsTrackingOnPath`) nigdy nie ładują beaconu.
 */

const CF_TOKEN = cloudflareAnalyticsToken();

export function Analytics() {
  const [record, setRecord] = useState<ConsentRecord | null>(null);
  const [guardReady, setGuardReady] = useState(false);
  const pathname = usePathname();
  const routeAllowed = allowsTrackingOnPath(pathname);

  useEffect(() => {
    // Stan początkowy z cookie (np. zgoda z poprzedniej wizyty) + subskrypcja zmian.
    setRecord(getConsent());
    return subscribeConsent(setRecord);
  }, []);

  const analyticsGranted = routeAllowed && record?.categories.analytics === true;

  // Sprzątanie pozostałości po dawnych trackerach (cookies GA/Meta) przy każdej zmianie zgody.
  useEffect(() => {
    syncTrackers({ analytics: analyticsGranted });
  }, [analyticsGranted]);

  // Bramka wysyłki przed pierwszym renderem skryptu (efekt → następny render → <Script>).
  useEffect(() => {
    if (!analyticsGranted || !CF_TOKEN || guardReady) return;
    installCloudflareBeaconGuard();
    setGuardReady(true);
  }, [analyticsGranted, guardReady]);

  if (!analyticsGranted || !CF_TOKEN || !guardReady) return null;

  return (
    <Script
      id="cf-web-analytics"
      src={CF_BEACON_SRC}
      strategy="afterInteractive"
      data-cf-beacon={cloudflareBeaconConfig(CF_TOKEN)}
    />
  );
}

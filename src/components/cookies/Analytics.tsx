'use client';

import { useEffect, useState } from 'react';
import Script from 'next/script';
import { usePathname } from 'next/navigation';
import { getConsent, type ConsentRecord } from '@/lib/consent';
import { subscribeConsent, syncTrackers } from '@/lib/consent-store';
import { allowsTrackingOnPath } from '@/lib/analytics/route-policy';
import { buildGaInitScript, buildMetaPixelScript } from '@/lib/security/csp-inline-scripts.mjs';

/**
 * Ładowanie skryptów analityki/marketingu — WYŁĄCZNIE po świadomej zgodzie.
 *
 * ZERO trackingu przed zgodą: dopóki użytkownik nie zaakceptuje danej kategorii, żaden
 * <Script> nie jest renderowany, więc GA / Meta Pixel się nie ładują. Komponent czyta
 * bieżącą zgodę przy montażu i reaguje na jej zmiany przez consent-store (bez reloadu).
 *
 * - kategoria `analytics`  → Google Analytics (gtag), z anonimizacją IP,
 * - kategoria `marketing`  → Meta Pixel.
 *
 * Identyfikatory pochodzą z env NEXT_PUBLIC_*; brak identyfikatora = nic się nie ładuje.
 */

const GA_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
const META_PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID;

export function Analytics() {
  const [record, setRecord] = useState<ConsentRecord | null>(null);
  const pathname = usePathname();
  const routeAllowed = allowsTrackingOnPath(pathname);

  useEffect(() => {
    // Stan początkowy z cookie (np. zgoda z poprzedniej wizyty) + subskrypcja zmian.
    setRecord(getConsent());
    return subscribeConsent(setRecord);
  }, []);

  const analyticsGranted = routeAllowed && record?.categories.analytics === true;
  const marketingGranted = routeAllowed && record?.categories.marketing === true;

  // Egzekwuj stan trackerów przy każdej zmianie zgody: skuteczne WYCOFANIE (ga-disable / fbq
  // revoke + czyszczenie cookies), a przy ponownej zgodzie zdjęcie blokady. Uzupełnia (nie
  // zastępuje) warunkowego renderowania <Script> — Invariant #7 (zero trackingu przed zgodą).
  useEffect(() => {
    syncTrackers({ analytics: analyticsGranted, marketing: marketingGranted });
  }, [analyticsGranted, marketingGranted]);

  return (
    <>
      {analyticsGranted && GA_ID ? (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
            strategy="afterInteractive"
          />
          <Script id="ga-init" strategy="afterInteractive">
            {buildGaInitScript(GA_ID)}
          </Script>
        </>
      ) : null}

      {marketingGranted && META_PIXEL_ID ? (
        <Script id="meta-pixel" strategy="afterInteractive">
          {buildMetaPixelScript(META_PIXEL_ID)}
        </Script>
      ) : null}
    </>
  );
}

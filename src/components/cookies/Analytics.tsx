'use client';

import { useEffect, useState } from 'react';
import Script from 'next/script';
import { getConsent, type ConsentRecord } from '@/lib/consent';
import { subscribeConsent } from '@/lib/consent-store';

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

  useEffect(() => {
    // Stan początkowy z cookie (np. zgoda z poprzedniej wizyty) + subskrypcja zmian.
    setRecord(getConsent());
    return subscribeConsent(setRecord);
  }, []);

  const analyticsGranted = record?.categories.analytics === true;
  const marketingGranted = record?.categories.marketing === true;

  return (
    <>
      {analyticsGranted && GA_ID ? (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
            strategy="afterInteractive"
          />
          <Script id="ga-init" strategy="afterInteractive">
            {`window.dataLayer = window.dataLayer || [];function gtag(){dataLayer.push(arguments);}gtag('js', new Date());gtag('config', '${GA_ID}', { anonymize_ip: true });`}
          </Script>
        </>
      ) : null}

      {marketingGranted && META_PIXEL_ID ? (
        <Script id="meta-pixel" strategy="afterInteractive">
          {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${META_PIXEL_ID}');fbq('track','PageView');`}
        </Script>
      ) : null}
    </>
  );
}

'use client';

import { useEffect, useState } from 'react';
import Script from 'next/script';
import { usePathname } from 'next/navigation';
import { getConsent, type ConsentRecord } from '@/lib/consent';
import { subscribeConsent } from '@/lib/consent-store';
import { allowsTrackingOnPath } from '@/lib/analytics/route-policy';

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
 * API do „odwołania" zgody w locie jak `ga-disable`/`fbq('consent','revoke')`; `next/script`
 * wstawia znacznik `<script>` bezpośrednio do DOM i nie usuwa go przy odmontowaniu komponentu —
 * dlatego, tak jak zapowiada Invariant #7, gwarancją jest brak ładowania PRZED zgodą i PO
 * odświeżeniu strony, a nie natychmiastowe zniknięcie już wstawionego znacznika w tej samej sesji.
 *
 * Kategoria `marketing` obecnie nie ładuje żadnego trackera (Meta Pixel usunięty); zostaje
 * w centrum zgód bez zmian, bo jej usunięcie wymagałoby zmiany treści/wersji polityki cookies —
 * patrz opis w PR #570 (decyzja dla właściciela).
 *
 * Token pochodzi z env `NEXT_PUBLIC_CF_WEB_ANALYTICS_TOKEN`; brak tokenu = nic się nie ładuje.
 */

const CF_ANALYTICS_TOKEN = process.env.NEXT_PUBLIC_CF_WEB_ANALYTICS_TOKEN;

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

  if (!analyticsGranted || !CF_ANALYTICS_TOKEN) return null;

  return (
    <Script
      id="cf-web-analytics"
      src="https://static.cloudflareinsights.com/beacon.min.js"
      data-cf-beacon={JSON.stringify({ token: CF_ANALYTICS_TOKEN })}
      strategy="afterInteractive"
    />
  );
}

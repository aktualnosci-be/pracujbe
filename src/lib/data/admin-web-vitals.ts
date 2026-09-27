/**
 * Warstwa danych panelu administratora — dane polowe Core Web Vitals (Cloudflare Web Analytics).
 *
 * Jak inne odczyty admina: najpierw `requireAdmin` (gdy portal ma bazę), potem wywołanie API.
 * Bez bazy (tryb DEMO) i bez konfiguracji Cloudflare — raport przykładowy oznaczony na stronie.
 * Błąd dostawcy trafia do kanału błędów jako sam kod (bez tokenu i treści odpowiedzi).
 */

import { requireAdmin } from '@/lib/data/admin';
import { isPortalDataConfigured } from '@/lib/db/portal';
import { captureError } from '@/lib/error-report';
import { fetchFieldWebVitals, type FieldWebVitalsResult } from '@/lib/web-vitals/cloudflare-client';
import { demoWebVitalsReport, type WebVitalsPeriod } from '@/lib/web-vitals/field-report';

export async function getFieldWebVitals(period: WebVitalsPeriod): Promise<FieldWebVitalsResult> {
  const portal = isPortalDataConfigured();
  if (portal) await requireAdmin();
  const result = await fetchFieldWebVitals(period);
  // Tryb DEMO (bez bazy, bez Cloudflare): raport przykładowy, oznaczony na stronie.
  if (!portal && result.status === 'unconfigured') {
    return { status: 'ok', report: demoWebVitalsReport(period, new Date()), accountId: null, demo: true };
  }
  if (result.status === 'error') {
    captureError(new Error(result.code), { area: 'adminWebVitals.fetch' });
  }
  return result;
}

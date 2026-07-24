import { timingSafeEqual } from 'node:crypto';

import { env, isAppReady, isProductionMode, readinessChecks } from '@/lib/env';

/**
 * Readiness/health endpoint (SEC-19 + P1-18) — dla monitoringu/load-balancera.
 *
 * Zwraca 200, gdy aplikacja jest gotowa obsługiwać ruch; 503, gdy tryb produkcyjny nie ma
 * KRYTYCZNEJ konfiguracji (fail-closed — błąd konfiguracji jest WIDOCZNY, nie „cichy" tryb demo).
 *
 * P3-01: publicznie zwracamy WYŁĄCZNIE ogólny `status` (ready/unconfigured) — mapa brakujących
 * usług (Stripe/Resend/Sentry…) ułatwiłaby rekonesans. Szczegółowy `checks`/`mode` jest widoczny
 * tylko dla monitoringu wewnętrznego: w trybie nieprodukcyjnym (lokalnie/staging) albo po podaniu
 * tokena `HEALTH_CHECK_SECRET` (nagłówek `x-health-token`). Nigdy nie ujawnia sekretów.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Stałoczasowe porównanie tokena (anty-timing). Zwraca false, gdy token nieustawiony/niezgodny. */
function tokenMatches(provided: string | null): boolean {
  const expected = process.env.HEALTH_CHECK_SECRET;
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function GET(request: Request): Response {
  const ready = isAppReady();
  const httpStatus = ready ? 200 : 503;
  const headers = { 'cache-control': 'no-store' } as const;

  // Szczegóły tylko dla monitoringu wewnętrznego: poza produkcją (dev/staging) lub z tokenem.
  const detailed = !isProductionMode() || tokenMatches(request.headers.get('x-health-token'));
  if (detailed) {
    return Response.json(
      { status: ready ? 'ok' : 'unconfigured', mode: env.appMode, checks: readinessChecks() },
      { status: httpStatus, headers },
    );
  }

  // Publicznie: ogólny liveness/readiness bez diagnostyki dostawców.
  return Response.json({ status: ready ? 'ok' : 'unconfigured' }, { status: httpStatus, headers });
}

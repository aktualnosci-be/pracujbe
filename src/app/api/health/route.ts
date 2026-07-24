import { env, isAppReady, readinessChecks } from '@/lib/env';

/**
 * Readiness/health endpoint (SEC-19 + P1-18) — dla monitoringu/load-balancera.
 *
 * Zwraca 200, gdy aplikacja jest gotowa obsługiwać ruch; 503, gdy tryb produkcyjny nie ma
 * KRYTYCZNEJ konfiguracji (fail-closed — błąd konfiguracji jest WIDOCZNY, nie „cichy" tryb demo).
 * `checks` raportuje stan zależności (bool, BEZ sekretów) — w tym opcjonalnych (Stripe/Resend/
 * webhooki), by monitoring widział braki, które nie blokują startu.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(): Response {
  const ready = isAppReady();
  return Response.json(
    {
      status: ready ? 'ok' : 'unconfigured',
      mode: env.appMode,
      checks: readinessChecks(),
    },
    { status: ready ? 200 : 503, headers: { 'cache-control': 'no-store' } },
  );
}

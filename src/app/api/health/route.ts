import { env, isAppReady, isSupabaseConfigured } from '@/lib/env';

/**
 * Readiness/health endpoint (SEC-19) — dla monitoringu/load-balancera.
 *
 * Zwraca 200, gdy aplikacja jest gotowa obsługiwać ruch; 503, gdy tryb produkcyjny nie ma
 * wymaganej konfiguracji (fail-closed — błąd konfiguracji jest WIDOCZNY, nie „cichy" tryb demo).
 * NIE ujawnia sekretów ani wartości env — tylko status i tryb.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(): Response {
  const ready = isAppReady();
  return Response.json(
    {
      status: ready ? 'ok' : 'unconfigured',
      mode: env.appMode,
      supabase: isSupabaseConfigured(),
    },
    { status: ready ? 200 : 503, headers: { 'cache-control': 'no-store' } },
  );
}

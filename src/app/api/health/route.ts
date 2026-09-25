import { env, isAppReady, isDatabaseConfigured, isProductionMode, readinessChecks } from '@/lib/env';
import { HEALTH_TOKEN_HEADER, healthTokenMatches } from '@/lib/ops/health-token';
import { isTurnstileEnabled } from '@/lib/turnstile/verify';

/**
 * Readiness/health endpoint (SEC-19 + P1-18 + #429) — dla monitoringu i healthchecku Railway.
 *
 * Zwraca 200, gdy aplikacja jest gotowa obsługiwać ruch; 503, gdy tryb produkcyjny nie ma
 * KRYTYCZNEJ konfiguracji (PostgreSQL domeny, Better Auth, limiter, https URL — `isAppReady`)
 * albo baza nie odpowiada na `SELECT 1` w krótkim czasie (`status: unavailable`). Healthcheck
 * odzwierciedla więc realną dostępność PostgreSQL, nie tylko obecność zmiennych.
 *
 * P3-01: publicznie zwracamy WYŁĄCZNIE ogólny `status` — mapa brakujących usług ułatwiłaby
 * rekonesans. Szczegółowy `checks`/`mode` jest widoczny tylko dla monitoringu wewnętrznego:
 * w trybie nieprodukcyjnym albo po podaniu tokena `HEALTH_CHECK_SECRET` (nagłówek
 * `x-health-token`). Nigdy nie ujawnia sekretów ani treści błędu bazy.
 * `checks.turnstile` (#46) = czy ochrona formularzy jest włączona — sam boolean, bez kluczy.
 * Czujki operacyjne (kolejki, webhooki, maintenance, połączenia) — `/api/health/ops` (#47).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Limit czasu sprawdzenia bazy: healthcheck nie może wisieć na zablokowanej puli. */
const DATABASE_PING_TIMEOUT_MS = 2_000;

/** `true` = baza odpowiedziała; `false` = błąd/timeout; `null` = nie sprawdzano (brak konfiguracji). */
async function pingDatabase(): Promise<boolean | null> {
  if (!isDatabaseConfigured()) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), DATABASE_PING_TIMEOUT_MS);
  });
  const ping = (async () => {
    const { getDomainPool } = await import('@/lib/db/runtime');
    const pool = await getDomainPool();
    const result = await pool.query<{ ok: number }>('SELECT 1 AS ok');
    return result.rows[0]?.ok === 1;
  })().catch(() => false);
  try {
    return await Promise.race([ping, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request: Request): Promise<Response> {
  const configured = isAppReady();
  // Łączność sprawdzamy tylko przy komplecie konfiguracji — nieskonfigurowana produkcja i tak 503.
  const database = configured ? await pingDatabase() : null;
  const ready = configured && database !== false;
  const status = !configured ? 'unconfigured' : ready ? 'ok' : 'unavailable';
  const httpStatus = ready ? 200 : 503;
  const headers = { 'cache-control': 'no-store' } as const;

  // Szczegóły tylko dla monitoringu wewnętrznego: poza produkcją (dev/staging) lub z tokenem.
  const detailed = !isProductionMode() || healthTokenMatches(request.headers.get(HEALTH_TOKEN_HEADER));
  if (detailed) {
    return Response.json(
      {
        status,
        mode: env.appMode,
        // Wersja artefaktu (`0.YYYYMMDD.M+SHA`) — test wdrożeniowy porównuje SHA (#12).
        version: process.env.NEXT_PUBLIC_APP_VERSION ?? null,
        checks: {
          ...readinessChecks(),
          ...(database === null ? {} : { databaseReachable: database }),
          turnstile: isTurnstileEnabled(),
        },
      },
      { status: httpStatus, headers },
    );
  }

  // Publicznie: ogólny liveness/readiness bez diagnostyki dostawców.
  return Response.json({ status }, { status: httpStatus, headers });
}

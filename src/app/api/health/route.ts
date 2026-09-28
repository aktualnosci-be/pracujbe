import { env, isAppReady, isDatabaseConfigured, isProductionMode, readinessChecks } from '@/lib/env';
import { HEALTH_TOKEN_HEADER, healthTokenMatches } from '@/lib/ops/health-token';
import { DATABASE_PING_CACHE_KEY, pingCache } from '@/lib/ops/health-ping-cache';
import { emailProviderFromEnv } from '@/lib/email/transport/select';
import { isTurnstileEnabled } from '@/lib/turnstile/verify';
import { portalLegalMode } from '@/lib/portal-mode';

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
 * `emailProvider` = wybrany dostawca poczty, `checks.emailProviderReady` = ma komplet kluczy.
 * `checks.turnstile` (#46) = czy ochrona formularzy jest włączona — sam boolean, bez kluczy.
 * `portalLegalMode` (#1136) = tryb produktu (`CLASSIFIEDS_ONLY` | `RECRUITMENT`) — tylko w szczegółach,
 * nie wpływa na gotowość (`isAppReady`).
 * Czujki operacyjne (kolejki, webhooki, maintenance, połączenia) — `/api/health/ops` (#47).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Limit czasu sprawdzenia bazy: healthcheck nie może wisieć na zablokowanej puli. */
const DATABASE_PING_TIMEOUT_MS = 2_000;

/**
 * `true` = baza odpowiedziała; `false` = błąd. BEZ timeoutu wewnątrz — to jest właśnie
 * obietnica, którą `pingCache` trzyma jako `inFlight` (patrz `pingDatabase` niżej): musi żyć
 * dokładnie tak długo, jak realne `pool.query`, inaczej single-flight przestaje chronić pulę
 * (#645 — timeout lokalny kończył `factory()` wcześniej niż zapytanie, więc `finally` w
 * `ttl-single-flight.ts` zdejmował wpis `inFlight`, zanim `pool.query` faktycznie się skończyło,
 * i kolejne, POZORNIE odrębne żądanie otwierało NASTĘPNE zapytanie na tej samej niedostępnej puli).
 */
async function pingDatabaseQuery(): Promise<boolean> {
  const { getDomainPool } = await import('@/lib/db/runtime');
  const pool = await getDomainPool();
  const result = await pool.query<{ ok: number }>('SELECT 1 AS ok');
  return result.rows[0]?.ok === 1;
}

/**
 * Single-flight dla całego procesu (#600), poprawione po #645: dowolna liczba RÓWNOLEGŁYCH
 * publicznych żądań `GET /api/health` dzieli NAJWYŻEJ jedno trwające `pool.query('SELECT 1')`
 * — reszta czeka na ten sam wynik zamiast otwierać nowe zapytanie. `pingCache.run` trzyma
 * BEZ TIMEOUTU realną obietnicę zapytania (`pingDatabaseQuery`), więc wpis `inFlight` znika
 * dopiero, gdy zapytanie FAKTYCZNIE się zakończy (sukcesem albo błędem) — nie wcześniej.
 *
 * Timeout (`DATABASE_PING_TIMEOUT_MS`) dotyczy WYŁĄCZNIE odpowiedzi TEGO żądania: `Promise.race`
 * jest tutaj, na zewnątrz `pingCache.run`, więc przegrana wyścigu z timeoutem nie odłącza ani
 * nie kończy dzielonej obietnicy zapytania — ona nadal trwa w tle i nadal jest tym, na co czekają
 * (i co blokuje nowe zapytanie dla) kolejne żądania, dopóki `pool.query` się nie rozstrzygnie.
 */
async function pingDatabase(): Promise<boolean | null> {
  if (!isDatabaseConfigured()) return null;
  const shared = pingCache.run(DATABASE_PING_CACHE_KEY, () => pingDatabaseQuery().catch(() => false));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), DATABASE_PING_TIMEOUT_MS);
  });
  try {
    return await Promise.race([shared, timeout]);
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
        // Nazwa dostawcy poczty (`emaillabs` | `resend` | `none`) — bez kluczy i adresów.
        emailProvider: emailProviderFromEnv().provider ?? 'none',
        // Tryb produktu (#1136): sama nazwa trybu, bez wpływu na status.
        portalLegalMode: portalLegalMode(),
      },
      { status: httpStatus, headers },
    );
  }

  // Publicznie: ogólny liveness/readiness bez diagnostyki dostawców.
  return Response.json({ status }, { status: httpStatus, headers });
}

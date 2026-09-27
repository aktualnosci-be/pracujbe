import { createTtlSingleFlightCache } from '@/lib/cache/ttl-single-flight';
import { env, isAppReady, isDatabaseConfigured, isProductionMode, readinessChecks } from '@/lib/env';
import { HEALTH_TOKEN_HEADER, healthTokenMatches } from '@/lib/ops/health-token';
import { emailProviderFromEnv } from '@/lib/email/transport/select';
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
 * `emailProvider` = wybrany dostawca poczty, `checks.emailProviderReady` = ma komplet kluczy.
 * `checks.turnstile` (#46) = czy ochrona formularzy jest włączona — sam boolean, bez kluczy.
 * Czujki operacyjne (kolejki, webhooki, maintenance, połączenia) — `/api/health/ops` (#47).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Limit czasu sprawdzenia bazy: healthcheck nie może wisieć na zablokowanej puli. */
const DATABASE_PING_TIMEOUT_MS = 2_000;

/**
 * `ttlMs: 0` — celowo BEZ ponownego użycia rozstrzygniętego wyniku (healthcheck ma odzwierciedlać
 * realny, BIEŻĄCY stan bazy na każde odrębne żądanie — patrz komentarz na górze pliku). Cache
 * chroni wyłącznie przed RÓWNOLEGŁYMI żądaniami (#600): dopóki jedno `pool.query('SELECT 1')`
 * trwa, kolejne żądania (nawet setki naraz) czekają na TEN SAM wynik zamiast otwierać nowe
 * zapytanie — to jest właściwa ochrona przed zalewem. Gdy zapytanie się zakończy, następne,
 * odrębne żądanie zawsze sprawdza bazę od nowa.
 */
const DATABASE_PING_CACHE_KEY = 'ping';

const pingCache = createTtlSingleFlightCache<boolean>({
  ttlMs: 0,
  maxEntries: 1,
});

/**
 * Tylko dla testów: `pingCache` żyje w module (jeden proces, #600/#645) i normalnie kończy
 * dzielony wpis dopiero, gdy realne zapytanie się rozstrzygnie. Test symulujący zawieszoną bazę
 * (mock `pool.query`, który NIGDY się nie rozstrzyga) inaczej trwale zatruwałby stan modułu na
 * resztę pliku testowego — kolejne, odrębne testy w tym samym pliku dzieliłyby ten sam, wiecznie
 * trwający wpis `inFlight` i healthcheck fałszywie zwracałby 503 po realnym odzyskaniu bazy.
 */
export function resetHealthPingCacheForTests(): void {
  pingCache.clear();
}

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
      },
      { status: httpStatus, headers },
    );
  }

  // Publicznie: ogólny liveness/readiness bez diagnostyki dostawców.
  return Response.json({ status }, { status: httpStatus, headers });
}

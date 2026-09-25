/**
 * Aplikacyjny rate limiting (F-05 / P2-02) oparty o trwały licznik w DB (RPC
 * `rate_limit_hit`, migracja 0015). Fixed window spójny między instancjami
 * (inaczej niż licznik w pamięci). Wołany z Server Actions (auth, aplikowanie).
 *
 * Zasady:
 * - PostgreSQL Railway (#24): `DATABASE_RATE_LIMIT_URL` + `RATE_LIMIT_KEY_SECRET` → osobny login
 *   z członkostwem wyłącznie w `pracujbe_rate_limit` (`checkDatabaseRateLimit`, klucz HMAC —
 *   do bazy nie trafia surowy adres IP ani identyfikator). Pierwszeństwo przed pulą service.
 * - Przejściowo: `rate_limit_hit` w transakcji service_role (`withServiceRole`, #25), gdy login
 *   limitera nie jest skonfigurowany.
 * - Brak jakiejkolwiek konfiguracji: tryb demo → `true`; tryb produkcyjny → akcje wrażliwe
 *   (auth, płatne API, publiczne formularze) blokowane, reszta przepuszczana.
 * - Błąd RPC / wyjątek -> akcje wrażliwe blokowane (fail-safe), pozostałe fail-open + Sentry.
 * - Klucz budowany z akcji + IP (+ opcjonalny identyfikator, np. userId).
 *
 * Nigdy nie ujawniamy użytkownikowi technikaliów — warstwa wyżej zamienia przekroczenie
 * na kod `RATE_LIMITED` (Invariant #8).
 */

import { headers } from 'next/headers';

import { isServiceDatabaseConfigured, withServiceRole } from '@/lib/db/portal';
import { rpc } from '@/lib/db/sql';
import { env, isProductionMode, isRateLimitDatabaseConfigured } from '@/lib/env';
import { captureError } from '@/lib/sentry';

/** Opcje limitu dla pojedynczej akcji. */
export interface RateLimitOptions {
  /** Maksymalna liczba zdarzeń w oknie. Domyślnie 30. */
  max?: number;
  /** Długość okna w sekundach. Domyślnie 60. */
  windowSeconds?: number;
  /** Dodatkowy człon klucza (np. userId) zawężający limit poza samo IP. */
  identifier?: string;
  /**
   * Czy klucz zawiera IP klienta (domyślnie tak). `false` = limit wyłącznie per `identifier`
   * (np. per firma przy imporcie AI #465 — zmiana IP nie daje nowej puli kosztownych wywołań).
   */
  perIp?: boolean;
}

const DEFAULT_MAX = 30;
const DEFAULT_WINDOW_SECONDS = 60;

/**
 * Akcje wrażliwe (uwierzytelnianie), dla których stosujemy fail-SAFE: gdy limiter
 * jest niedostępny (błąd RPC/wyjątek), blokujemy żądanie, zamiast otwierać ścieżkę
 * do bruteforce logowania / spamu rejestracji / resetu hasła. Dla pozostałych akcji
 * zachowujemy fail-open (awaria limitera nie odcina zwykłego ruchu).
 */
const FAIL_SAFE_ACTIONS: ReadonlySet<string> = new Set([
  'signin',
  'register',
  'password-reset',
  'password-update',
  'verify-email',
  // Import ogłoszenia przez AI (#465): każde wywołanie kosztuje — awaria limitera nie może
  // otwierać nieograniczonych wywołań płatnego API.
  'job-import',
  'job-import-day',
  // Asystent redagowania oferty (#37) — płatne API, jak import.
  'job-assist',
  'job-assist-day',
  // Aplikacja bez konta (#98): publiczny formularz wysyłający e-maile na podany adres.
  'guest-apply',
  'guest-apply-email',
]);

/**
 * Adres IP klienta. Głównym źródłem jest `x-real-ip` (ustawiane przez platformę/proxy,
 * niespoofowalne przez klienta). Dopiero w razie jego braku sięgamy po `x-forwarded-for`,
 * ale bierzemy PRAWY (ostatni) token — dopisany przez najbliższe zaufane proxy — a nie
 * lewy, który klient może dowolnie sfałszować. Fallback: `unknown`.
 */
async function clientIp(): Promise<string> {
  const store = await headers();

  const realIp = store.get('x-real-ip')?.trim();
  if (realIp) {
    return realIp;
  }

  const forwarded = store.get('x-forwarded-for');
  if (forwarded) {
    const parts = forwarded
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    const last = parts[parts.length - 1];
    if (last) {
      return last;
    }
  }

  return 'unknown';
}

/**
 * Adres niepoprawny albo nieustalony → wspólny zastępczy klucz. Limiter PostgreSQL wymaga
 * poprawnego IP; brak nagłówka proxy nie może ani wyłączać limitu, ani blokować wszystkich.
 */
const UNKNOWN_IP = '0.0.0.0';

async function checkPostgresRateLimit(
  action: string,
  max: number,
  windowSeconds: number,
  opts: RateLimitOptions | undefined,
): Promise<boolean> {
  const [{ isIP }, { getRateLimitPool }, { checkDatabaseRateLimit }] = await Promise.all([
    import('node:net'),
    import('@/lib/db/runtime'),
    import('@/lib/db/rate-limit'),
  ]);
  const ip = opts?.perIp === false ? UNKNOWN_IP : await clientIp();
  // Nazwa akcji w kluczu HMAC: tylko znaki dozwolone przez helper (np. `job-import-day`).
  const allowed = await checkDatabaseRateLimit(await getRateLimitPool(), {
    action,
    trustedClientIp: isIP(ip) === 0 ? UNKNOWN_IP : ip,
    ...(opts?.identifier ? { identifier: opts.identifier } : {}),
    max,
    windowSeconds,
    keySecret: env.rateLimitKeySecret ?? '',
  });
  // Helper zwraca false także przy błędzie bazy — dla akcji zwykłych nie odcinamy ruchu,
  // ale nie odróżnimy tu awarii od przekroczenia; akcje wrażliwe zostają zablokowane.
  return allowed;
}

/**
 * Sprawdza limit zapytań dla `action` per IP (+ opcjonalny identyfikator).
 * Zwraca `true`, gdy żądanie mieści się w limicie; `false`, gdy przekroczono.
 *
 * Brak konfiguracji: demo → `true`, produkcja → blokada akcji wrażliwych.
 */
export async function checkRateLimit(action: string, opts?: RateLimitOptions): Promise<boolean> {
  const max = opts?.max ?? DEFAULT_MAX;
  const windowSeconds = opts?.windowSeconds ?? DEFAULT_WINDOW_SECONDS;

  if (isRateLimitDatabaseConfigured()) {
    try {
      return await checkPostgresRateLimit(action, max, windowSeconds, opts);
    } catch (e) {
      captureError(e, { area: 'rate-limit', action });
      return !FAIL_SAFE_ACTIONS.has(action);
    }
  }

  if (!isServiceDatabaseConfigured()) {
    return isProductionMode() ? !FAIL_SAFE_ACTIONS.has(action) : true;
  }

  try {
    const ip = opts?.perIp === false ? undefined : await clientIp();
    const key = [action, ip, opts?.identifier].filter(Boolean).join(':');

    // Limiter woła się wyłącznie w transakcji service_role (SEC-01): RPC `rate_limit_hit`
    // jest odebrany anon/authenticated, a klucz/limit/okno budujemy po stronie serwera.
    const allowed = await withServiceRole((tx) =>
      rpc<boolean>(tx, 'rate_limit_hit', {
        p_key: key,
        p_max: max,
        p_window_seconds: windowSeconds,
      }),
    );

    // RPC zwraca boolean (true = w limicie). Tylko jawne `false` blokuje.
    return allowed !== false;
  } catch (e) {
    captureError(e, { area: 'rate-limit', action });
    // Akcje wrażliwe: fail-safe (blokuj). Pozostałe: fail-open.
    return !FAIL_SAFE_ACTIONS.has(action);
  }
}

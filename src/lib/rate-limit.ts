/**
 * Aplikacyjny rate limiting (F-05 / P2-02) oparty o trwały licznik w DB (RPC
 * `rate_limit_hit`, migracja 0015). Fixed window spójny między instancjami serverless
 * (inaczej niż licznik w pamięci). Wołany z Server Actions (auth, aplikowanie).
 *
 * Zasady:
 * - Tryb demo (brak konfiguracji bazy: ani puli domeny `isPortalDataConfigured()`, ani puli
 *   zadań serwerowych `isServiceDatabaseConfigured()`) -> zawsze `true` (nie blokujemy).
 *   Skonfigurowany portal BEZ puli service (dryf env) nie jest demo: wywołanie się nie
 *   powiedzie i obowiązuje reguła fail-open/fail-safe poniżej (+ Sentry).
 * - Licznik woła `rate_limit_hit` w krótkiej transakcji service_role (`withServiceRole`, #25).
 * - Błąd RPC / wyjątek -> fail-open (`true`) + zgłoszenie do Sentry — awaria limitera
 *   nie może odcinać użytkowników.
 * - Klucz budowany z akcji + IP (+ opcjonalny identyfikator, np. userId).
 *
 * Nigdy nie ujawniamy użytkownikowi technikaliów — warstwa wyżej zamienia przekroczenie
 * na kod `RATE_LIMITED` (Invariant #8).
 */

import { headers } from 'next/headers';

import { isPortalDataConfigured, isServiceDatabaseConfigured, withServiceRole } from '@/lib/db/portal';
import { rpc } from '@/lib/db/sql';
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
  // Import ogłoszenia przez AI (#465): każde wywołanie kosztuje — awaria limitera nie może
  // otwierać nieograniczonych wywołań płatnego API.
  'job-import',
  'job-import-day',
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
 * Sprawdza limit zapytań dla `action` per IP (+ opcjonalny identyfikator).
 * Zwraca `true`, gdy żądanie mieści się w limicie; `false`, gdy przekroczono.
 *
 * Tryb demo (brak konfiguracji bazy) daje `true`; błąd RPC/wyjątek — fail-open (`true`),
 * a dla akcji z `FAIL_SAFE_ACTIONS` fail-safe (`false`).
 */
export async function checkRateLimit(action: string, opts?: RateLimitOptions): Promise<boolean> {
  if (!isPortalDataConfigured() && !isServiceDatabaseConfigured()) {
    return true;
  }

  const max = opts?.max ?? DEFAULT_MAX;
  const windowSeconds = opts?.windowSeconds ?? DEFAULT_WINDOW_SECONDS;

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

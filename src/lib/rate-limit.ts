/**
 * Aplikacyjny rate limiting (F-05 / P2-02) oparty o trwały licznik w DB (RPC
 * `rate_limit_hit`, migracja 0015). Fixed window spójny między instancjami serverless
 * (inaczej niż licznik w pamięci). Wołany z Server Actions (auth, aplikowanie).
 *
 * Zasady:
 * - Tryb demo (brak konfiguracji Supabase) -> zawsze `true` (nie blokujemy).
 * - Błąd RPC / wyjątek -> fail-open (`true`) + zgłoszenie do Sentry — awaria limitera
 *   nie może odcinać użytkowników.
 * - Klucz budowany z akcji + IP (+ opcjonalny identyfikator, np. userId).
 *
 * Nigdy nie ujawniamy użytkownikowi technikaliów — warstwa wyżej zamienia przekroczenie
 * na kod `RATE_LIMITED` (Invariant #8).
 */

import { headers } from 'next/headers';

import { isSupabaseConfigured } from '@/lib/env';
import { captureError } from '@/lib/sentry';
import { createAdminClient } from '@/lib/supabase/admin';

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
 * Fail-open: brak konfiguracji Supabase oraz każdy błąd RPC/wyjątek dają `true`.
 */
export async function checkRateLimit(action: string, opts?: RateLimitOptions): Promise<boolean> {
  if (!isSupabaseConfigured()) {
    return true;
  }

  const max = opts?.max ?? DEFAULT_MAX;
  const windowSeconds = opts?.windowSeconds ?? DEFAULT_WINDOW_SECONDS;

  try {
    const ip = opts?.perIp === false ? undefined : await clientIp();
    const key = [action, ip, opts?.identifier].filter(Boolean).join(':');

    // Limiter woła się wyłącznie zaufanym klientem service_role (SEC-01): RPC `rate_limit_hit`
    // jest odebrany anon/authenticated, a klucz/limit/okno budujemy po stronie serwera.
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc('rate_limit_hit', {
      p_key: key,
      p_max: max,
      p_window_seconds: windowSeconds,
    });

    if (error) {
      captureError(error, { area: 'rate-limit', action });
      // Akcje wrażliwe: fail-safe (blokuj). Pozostałe: fail-open.
      return !FAIL_SAFE_ACTIONS.has(action);
    }

    // RPC zwraca boolean (true = w limicie). Tylko jawne `false` blokuje.
    return data !== false;
  } catch (e) {
    captureError(e, { area: 'rate-limit', action });
    // Akcje wrażliwe: fail-safe (blokuj). Pozostałe: fail-open.
    return !FAIL_SAFE_ACTIONS.has(action);
  }
}

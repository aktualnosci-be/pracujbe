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
import { createServerClient } from '@/lib/supabase/server';

/** Opcje limitu dla pojedynczej akcji. */
export interface RateLimitOptions {
  /** Maksymalna liczba zdarzeń w oknie. Domyślnie 30. */
  max?: number;
  /** Długość okna w sekundach. Domyślnie 60. */
  windowSeconds?: number;
  /** Dodatkowy człon klucza (np. userId) zawężający limit poza samo IP. */
  identifier?: string;
}

const DEFAULT_MAX = 30;
const DEFAULT_WINDOW_SECONDS = 60;

/** Adres IP klienta z `x-forwarded-for` (pierwszy wpis) z fallbackiem na `x-real-ip`. */
async function clientIp(): Promise<string> {
  const store = await headers();
  const forwarded = store.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) {
      return first;
    }
  }
  return store.get('x-real-ip')?.trim() || 'unknown';
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
    const ip = await clientIp();
    const key = [action, ip, opts?.identifier].filter(Boolean).join(':');

    const supabase = await createServerClient();
    const { data, error } = await supabase.rpc('rate_limit_hit', {
      p_key: key,
      p_max: max,
      p_window_seconds: windowSeconds,
    });

    if (error) {
      captureError(error, { area: 'rate-limit', action });
      return true; // fail-open
    }

    // RPC zwraca boolean (true = w limicie). Tylko jawne `false` blokuje.
    return data !== false;
  } catch (e) {
    captureError(e, { area: 'rate-limit', action });
    return true; // fail-open
  }
}

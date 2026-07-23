import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import { AppError } from '@/lib/errors';

/**
 * Klient Supabase z uprawnieniami SERVICE ROLE — omija RLS.
 *
 * ⚠️ TYLKO SERWER (zaufany kod: Server Actions / Route Handlers / worker).
 * NIGDY nie importuj tego modułu w komponencie klienckim ani w kodzie trafiającym do
 * bundle'a przeglądarki (Invariant #6). Klucz `SUPABASE_SERVICE_ROLE_KEY` nie jest
 * `NEXT_PUBLIC_*` i nie może wyciec do klienta.
 *
 * NIE rzuca przy imporcie bez env — brak konfiguracji ujawnia się dopiero przy wywołaniu.
 */
export function createAdminClient(): SupabaseClient {
  // Zabezpieczenie runtime: gdyby moduł omyłkowo trafił do przeglądarki, nie inicjalizuj.
  if (typeof window !== 'undefined') {
    throw new AppError('INTERNAL', {
      context: { reason: 'admin_client_in_browser' },
    });
  }

  const url = env.supabaseUrl;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new AppError('INTERNAL', {
      context: { reason: 'supabase_admin_env_missing' },
    });
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

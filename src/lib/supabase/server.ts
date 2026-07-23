import { cookies } from 'next/headers';
import { createServerClient as createSSRServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import { AppError } from '@/lib/errors';

/**
 * Klient Supabase dla kodu serwerowego z sesją użytkownika (RSC / Server Actions /
 * Route Handlers). Czyta/zapisuje cookies sesji przez `next/headers`.
 *
 * NIE rzuca przy imporcie bez env — brak konfiguracji ujawnia się dopiero przy wywołaniu
 * (`AppError('INTERNAL')`). Kod publiczny powinien najpierw sprawdzać `isSupabaseConfigured()`.
 */
export async function createServerClient(): Promise<SupabaseClient> {
  const url = env.supabaseUrl;
  const anonKey = env.supabaseAnonKey;

  if (!url || !anonKey) {
    throw new AppError('INTERNAL', {
      context: { reason: 'supabase_env_missing', client: 'server' },
    });
  }

  const cookieStore = await cookies();

  return createSSRServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Wywołanie z komponentu serwerowego (cookies read-only) — ignorujemy.
          // Odświeżanie sesji odbywa się w middleware.
        }
      },
    },
  });
}

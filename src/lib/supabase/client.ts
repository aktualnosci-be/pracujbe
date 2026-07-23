import { createBrowserClient as createSSRBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import { AppError } from '@/lib/errors';

/**
 * Klient Supabase dla komponentów klienckich (anon key).
 * Używaj tylko w kodzie z `"use client"` przy realnej interakcji z Auth/DB.
 *
 * Rzuca `AppError('INTERNAL')` dopiero przy wywołaniu, gdy brak env — nie przy imporcie.
 */
export function createBrowserClient(): SupabaseClient {
  const url = env.supabaseUrl;
  const anonKey = env.supabaseAnonKey;

  if (!url || !anonKey) {
    throw new AppError('INTERNAL', {
      context: { reason: 'supabase_env_missing', client: 'browser' },
    });
  }

  return createSSRBrowserClient(url, anonKey);
}

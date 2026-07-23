import createIntlMiddleware from 'next-intl/middleware';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import type { NextRequest } from 'next/server';

import { routing } from './i18n/routing';
import { env, isSupabaseConfigured } from '@/lib/env';

/**
 * Middleware = next-intl + odświeżanie sesji Supabase.
 *
 * 1. next-intl (wykrywanie języka z Accept-Language dla "/", prefiks locale, redirecty
 *    nieobsłużonych ścieżek) — uruchamiane ZAWSZE, jego odpowiedź jest bazą.
 * 2. Sesja Supabase (@supabase/ssr): przy skonfigurowanym env odświeżamy token
 *    (`getUser()` rotuje wygasły access token na podstawie refresh tokena) i przenosimy
 *    zaktualizowane cookies na odpowiedź next-intl. Panele (candidate/employer/onboarding)
 *    polegają na tym — serwerowy guard w layoutcie (`getUser()` w RSC nie może zapisać
 *    cookies) zobaczy świeżą sesję tylko dzięki rotacji tutaj.
 *
 * Bez env (`isSupabaseConfigured() === false`) NIE inicjujemy Supabase — działa sam
 * next-intl (tryb demo). Matcher wyklucza api, auth (callback poza i18n), pliki wewnętrzne
 * Next/Vercel oraz assety (wszystko z kropką).
 */
const handleIntl = createIntlMiddleware(routing);

export default async function middleware(request: NextRequest) {
  // 1) next-intl — bazowa odpowiedź (może być redirectem/rewrite z prefiksem locale).
  const response = handleIntl(request);

  // 2) Brak env → tryb demo: nie inicjuj Supabase, zwróć samą odpowiedź next-intl.
  const url = env.supabaseUrl;
  const anonKey = env.supabaseAnonKey;
  if (!isSupabaseConfigured() || !url || !anonKey) {
    return response;
  }

  // 3) Odśwież sesję i przenieś zaktualizowane cookies na odpowiedź next-intl.
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Wymusza walidację/rotację tokenu i (w razie potrzeby) zapis cookies przez setAll.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  // Pomijamy: api, auth (callback OAuth/e-mail — obsługiwany poza i18n), pliki wewnętrzne
  // Next/Vercel oraz wszystko z kropką (assety, .xml, .txt). `auth` MUSI być wykluczone,
  // inaczej /auth/callback jest przekierowywany na /{locale}/auth/callback (404).
  matcher: ['/((?!api|auth|_next|_vercel|.*\\..*).*)'],
};

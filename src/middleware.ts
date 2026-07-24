import createIntlMiddleware from 'next-intl/middleware';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { routing } from './i18n/routing';
import { env, isAppReady, isSupabaseConfigured } from '@/lib/env';

/**
 * Fail-closed (SEC-19): w trybie produkcyjnym bez konfiguracji NIE pokazujemy fikcyjnych
 * (demo) paneli — zwracamy 503 maintenance, aby błąd konfiguracji był WIDOCZNY (health check,
 * monitoring), a nie „cichy" tryb demo. Treść neutralna, bez technikaliów (Invariant #8).
 */
const MAINTENANCE_HTML =
  '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
  '<meta name="robots" content="noindex"><title>Service unavailable</title></head>' +
  '<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;text-align:center">' +
  '<h1 style="font-size:1.25rem">Serwis chwilowo niedostępny</h1>' +
  '<p style="color:#64748B">Trwają prace techniczne. Spróbuj ponownie za chwilę.<br>' +
  'Service temporarily unavailable. Please try again shortly.</p></body></html>';

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
  // 0) Fail-closed (SEC-19): produkcja bez konfiguracji → 503 maintenance, nie tryb demo.
  if (!isAppReady()) {
    return new NextResponse(MAINTENANCE_HTML, {
      status: 503,
      headers: { 'content-type': 'text/html; charset=utf-8', 'retry-after': '120' },
    });
  }

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

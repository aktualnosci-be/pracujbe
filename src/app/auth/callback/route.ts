import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

import { env } from '@/lib/env';
import { routing, type Locale } from '@/i18n/routing';
import { bootstrapCompany } from '@/lib/actions/auth';
import { safeNextPath } from '@/lib/validation/auth';

/**
 * Route handler callbacku Auth: wymienia kod (PKCE) na sesję (`exchangeCodeForSession`)
 * i przekierowuje do panelu wg roli (albo do bezpiecznego `next`, jeśli podany).
 *
 * Cookies sesji ustawiane przez `@supabase/ssr` zbieramy w trakcie wymiany, a następnie
 * przenosimy na końcową odpowiedź przekierowującą (dopiero po ustaleniu celu).
 *
 * UWAGA integracyjna: middleware i18n (localePrefix: 'always') przekierowuje ścieżki bez
 * prefiksu języka. Aby ten handler był osiągalny pod `/auth/callback`, matcher w
 * `src/middleware.ts` powinien pomijać `auth` (np. `'/((?!api|auth|_next|_vercel|.*\\..*).*)'`).
 *
 * Nie ujawniamy technikaliów (Invariant #8): przy każdym niepowodzeniu przekierowujemy na
 * stronę logowania z neutralnym kodem błędu.
 */

type PendingCookie = { name: string; value: string; options: CookieOptions };

function isLocale(value: string | null): value is Locale {
  const supported: readonly string[] = routing.locales;
  return value !== null && supported.includes(value);
}

function panelPathForRole(role: string | undefined): string {
  if (role === 'employer') {
    return '/employer';
  }
  if (role === 'admin') {
    return '/admin';
  }
  return '/candidate';
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  // Ta sama walidacja co przy logowaniu/rejestracji (brak open redirect, wymagany prefiks języka).
  const next = safeNextPath(searchParams.get('next'));
  const localeParam = searchParams.get('locale');
  const locale: Locale = isLocale(localeParam) ? localeParam : routing.defaultLocale;

  const errorTarget = `/${locale}/logowanie?error=INTERNAL`;

  if (!code || !env.supabaseUrl || !env.supabaseAnonKey) {
    return NextResponse.redirect(new URL(errorTarget, origin));
  }

  const pendingCookies: PendingCookie[] = [];
  const supabase = createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: PendingCookie[]) {
        for (const { name, value, options } of cookiesToSet) {
          pendingCookies.push({ name, value, options });
        }
      },
    },
  });

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.session) {
    return NextResponse.redirect(new URL(errorTarget, origin));
  }

  // Rola: potrzebna do bootstrapu firmy oraz (gdy brak `next`) do celu przekierowania.
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', data.session.user.id)
    .maybeSingle();
  const role = (profile as { role?: string } | null)?.role;

  // Pracodawca bez firmy → utwórz firmę + właściciela (idempotentnie). Przekazujemy klienta,
  // który po wymianie kodu ma sesję w pamięci (cookie sesji trafiają na odpowiedź dopiero niżej,
  // więc świeżo utworzony klient jeszcze by ich nie widział). Błąd nie blokuje logowania.
  if (role === 'employer') {
    await bootstrapCompany(supabase);
  }

  const target = next ?? `/${locale}${panelPathForRole(role)}`;

  const response = NextResponse.redirect(new URL(target, origin));
  for (const cookie of pendingCookies) {
    response.cookies.set(cookie.name, cookie.value, cookie.options);
  }
  return response;
}

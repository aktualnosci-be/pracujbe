import { NextResponse } from 'next/server';

import { isLocale, routing } from '@/i18n/routing';
import {
  SITE_ACCESS_COOKIE,
  SITE_ACCESS_DENIED_PARAM,
  SITE_ACCESS_MAX_AGE,
  constantTimeEqual,
  getSiteAccessPassword,
  siteAccessReturnPath,
  siteAccessToken,
} from '@/lib/site-access';

/**
 * Formularz bramki dostępu (patrz `src/lib/site-access.ts`). Poprawne hasło → cookie z HMAC
 * hasła i powrót na żądaną stronę; błędne → powrót z flagą błędu po krótkim opóźnieniu
 * (utrudnia zgadywanie). Hasło nie jest logowane ani odsyłane.
 */

export const dynamic = 'force-dynamic';

const FAILURE_DELAY_MS = 750;

/**
 * Przekierowanie względne (`Location: /pl/...`). Za proxy Railway `request.url` wskazuje
 * wewnętrzny adres (np. https://localhost:8080), więc absolutny URL z niego wysłałby
 * przeglądarkę donikąd; ścieżka względna zawsze zostaje na domenie, z której przyszło żądanie.
 */
function redirectTo(path: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { location: path } });
}

export async function POST(request: Request): Promise<Response> {
  const expected = getSiteAccessPassword();
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    form = new FormData();
  }
  const rawLocale = form.get('locale');
  const locale = isLocale(rawLocale) ? rawLocale : routing.defaultLocale;
  const target = siteAccessReturnPath(
    typeof form.get('next') === 'string' ? (form.get('next') as string) : null,
    locale,
  );

  // Bramka wyłączona — nic do sprawdzania.
  if (!expected) return redirectTo(target);

  const password = form.get('password');
  const given = typeof password === 'string' ? password.trim() : '';
  const [givenToken, expectedToken] = await Promise.all([
    siteAccessToken(given || '\u0000'),
    siteAccessToken(expected),
  ]);

  if (!given || !constantTimeEqual(givenToken, expectedToken)) {
    await new Promise((resolve) => setTimeout(resolve, FAILURE_DELAY_MS));
    const url = new URL(target, 'https://pracuj.invalid');
    url.searchParams.set(SITE_ACCESS_DENIED_PARAM, 'denied');
    return redirectTo(`${url.pathname}${url.search}`);
  }

  const response = redirectTo(target);
  response.cookies.set(SITE_ACCESS_COOKIE, expectedToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure:
      request.headers.get('x-forwarded-proto') === 'https' ||
      new URL(request.url).protocol === 'https:',
    path: '/',
    maxAge: SITE_ACCESS_MAX_AGE,
  });
  return response;
}

export function GET(): Response {
  return redirectTo(`/${routing.defaultLocale}`);
}

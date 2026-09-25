import createIntlMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';

import { routing } from './i18n/routing';
import { resolveCitySlugAlias } from '@/lib/locations/city-aliases';
import { isOneTimeLinkPath } from '@/lib/analytics/route-policy';
import { guestLinkPurpose } from '@/lib/guest-apply/link-state';
import { isAppReady } from '@/lib/env';
import {
  SITE_ACCESS_COOKIE,
  SITE_ACCESS_DENIED_PARAM,
  getSiteAccessPassword,
  hasSiteAccess,
  pickGateLocale,
  renderSiteAccessPage,
  siteAccessReturnPath,
} from '@/lib/site-access';

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
 * Middleware = bramka hasła + fail-closed gotowości + next-intl.
 *
 * Sesje (#24) sprawdza serwer (Node) w guardach paneli i akcjach: Better Auth + PostgreSQL
 * (`getCurrentIdentity`). Middleware działa na Edge, więc NIE łączy się z bazą, nie czyta ani
 * nie odświeża cookie sesji i nie podejmuje decyzji o dostępie — nie ma tu też żadnego
 * `Set-Cookie` zależnego od użytkownika. Matcher wyklucza api, auth, pliki wewnętrzne
 * Next/Vercel oraz assety (wszystko z kropką).
 */
const handleIntl = createIntlMiddleware(routing);

/**
 * Nagłówek dla odpowiedzi, które nie mogą trafić do cache współdzielonego (#298). Strony
 * publiczne są statyczne/ISR i dostają `s-maxage`; middleware wykonuje się jednak przy KAŻDYM
 * żądaniu (także trafieniu w cache ISR), więc tu nadpisujemy nagłówek, gdy odpowiedź zależy od
 * żądającego: bramka hasła (CDN nie może podać strony osobie bez cookie dostępu).
 */
const PRIVATE_CACHE_CONTROL = 'private, no-store';

function protectOneTimeResponse(request: NextRequest, response: NextResponse): NextResponse {
  if (isOneTimeLinkPath(request.nextUrl.pathname)) {
    response.headers.set('cache-control', PRIVATE_CACHE_CONTROL);
    response.headers.set('referrer-policy', 'no-referrer');
    response.headers.set('x-robots-tag', 'noindex, nofollow');
  }
  return response;
}

/**
 * Linki gościa z tokenem w query (format sprzed #506) są odrzucane (#505): token w query trafia
 * do logów pierwszego żądania, więc nie przyjmujemy go jako uprawnienia. Czysty URL bez cookie —
 * strona pokazuje „link nieprawidłowy” z prośbą o ponowne wysłanie aplikacji (nowy link ma token
 * we fragmencie). Cookie staged z nowego linku zostaje nietknięte.
 */
function rejectLegacyGuestLink(request: NextRequest): NextResponse | null {
  if (!guestLinkPurpose(request.nextUrl.pathname) || !request.nextUrl.searchParams.has('token')) return null;
  const url = request.nextUrl.clone();
  url.search = '';
  return protectOneTimeResponse(request, NextResponse.redirect(url, 303));
}

const CITY_LANDING_RE = /^\/([a-z]{2})\/praca\/miasto\/([^/]+)\/?$/;

/**
 * Nazwa miasta w dowolnym języku / inna wielkość liter → 308 na kanoniczny klucz (#219).
 * Robimy to tutaj, a nie w stronie: landing jest ISR, a przekierowanie z renderu ISR
 * wysyłało zdublowany nagłówek `Location` (#298).
 */
function cityAliasRedirect(request: NextRequest): NextResponse | null {
  const match = CITY_LANDING_RE.exec(request.nextUrl.pathname);
  if (!match) return null;
  const [, locale, slug] = match;
  const supported: readonly string[] = routing.locales;
  if (!locale || !slug || !supported.includes(locale)) return null;
  const key = resolveCitySlugAlias(slug);
  if (!key || key === slug) return null;
  const url = request.nextUrl.clone();
  url.pathname = `/${locale}/praca/miasto/${key}`;
  return NextResponse.redirect(url, 308);
}

/**
 * Bramka „w przygotowaniu” (`SITE_ACCESS_PASSWORD`): bez ważnego cookie każda strona zwraca
 * formularz hasła (503 + noindex). Sprawdzana przed wszystkim innym — także przed SEC-19.
 */
async function siteAccessGate(request: NextRequest): Promise<NextResponse | null> {
  const password = getSiteAccessPassword();
  if (!password) return null;
  if (await hasSiteAccess(request.cookies.get(SITE_ACCESS_COOKIE)?.value, password)) return null;

  const { pathname, searchParams } = request.nextUrl;
  const locale = pickGateLocale(pathname, request.headers.get('accept-language'));
  const error = searchParams.get(SITE_ACCESS_DENIED_PARAM) === 'denied';
  const cleanSearch = new URLSearchParams(searchParams);
  cleanSearch.delete(SITE_ACCESS_DENIED_PARAM);
  const query = cleanSearch.toString();
  const next = siteAccessReturnPath(`${pathname}${query ? `?${query}` : ''}`, locale);

  return new NextResponse(renderSiteAccessPage({ locale, next, error }), {
    status: 503,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'retry-after': '3600',
      'x-robots-tag': 'noindex, nofollow',
    },
  });
}

export default async function middleware(request: NextRequest) {
  const guestRedirect = rejectLegacyGuestLink(request);
  if (guestRedirect) return guestRedirect;

  const gated = await siteAccessGate(request);
  if (gated) return protectOneTimeResponse(request, gated);

  // 0) Fail-closed (SEC-19): produkcja bez konfiguracji → 503 maintenance, nie tryb demo.
  if (!isAppReady()) {
    return protectOneTimeResponse(request, new NextResponse(MAINTENANCE_HTML, {
      status: 503,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'retry-after': '120',
      },
    }));
  }

  const cityRedirect = cityAliasRedirect(request);
  if (cityRedirect) return cityRedirect;

  // 1) next-intl — bazowa odpowiedź (może być redirectem/rewrite z prefiksem locale).
  const response = handleIntl(request);
  protectOneTimeResponse(request, response);
  // Serwis za bramką hasła: odpowiedź dla osoby z dostępem nie może trafić do cache współdzielonego.
  if (getSiteAccessPassword()) response.headers.set('cache-control', PRIVATE_CACHE_CONTROL);

  return response;
}

export const config = {
  // Pomijamy: api (w tym /api/auth), auth (dawny callback — ścieżki bez locale nie są
  // przekierowywane), pliki wewnętrzne Next/Vercel oraz wszystko z kropką (assety, .xml, .txt).
  matcher: ['/((?!api|auth|_next|_vercel|.*\\..*).*)'],
};

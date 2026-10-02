import createIntlMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';

import { routing } from './i18n/routing';
import { resolveCitySlugAlias } from '@/lib/locations/city-aliases';
import { isOneTimeLinkPath, isPrivateRoutePath } from '@/lib/analytics/route-policy';
import { PANEL_RETURN_PATH_HEADER, panelReturnPath } from '@/lib/auth/panel-return-path';
import { guestLinkPurpose } from '@/lib/guest-apply/link-state';
import { isAppReady } from '@/lib/env';
import { isOversizedPublicAction } from '@/lib/http/public-action-body-limit';
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
 * Next/Vercel oraz jawnie wymienione assety (patrz `config` niżej, #1035).
 */
const handleIntl = createIntlMiddleware(routing);

/**
 * Nagłówek dla odpowiedzi, które nie mogą trafić do cache współdzielonego (#298). Strony
 * publiczne są statyczne/ISR i dostają `s-maxage`; middleware wykonuje się jednak przy KAŻDYM
 * żądaniu (także trafieniu w cache ISR), więc tu nadpisujemy nagłówek, gdy odpowiedź zależy od
 * żądającego: bramka hasła (CDN nie może podać strony osobie bez cookie dostępu).
 */
const PRIVATE_CACHE_CONTROL = 'private, no-store';

/**
 * Trasy prywatne (panele, auth, jednorazowe linki — `isPrivateRoutePath`) nie mogą przekazać
 * własnej ścieżki ani query jako `document.referrer` kolejnemu dokumentowi (#1218): globalne
 * `strict-origin-when-cross-origin` wysyła pełny adres przy przejściu w obrębie witryny, więc
 * publiczna strona otwarta z panelu w nowej karcie oddałaby np. `/admin/uzytkownicy?q=<e-mail>`
 * beaconowi analityki. `strict-origin` = sam origin, zawsze (nie `no-referrer`: przy tej polityce
 * przeglądarka wysyła `Origin: null` w POST z tego dokumentu, a Server Actions i trasy eksportu
 * sprawdzają `Origin`). Jednorazowe linki (bez formularzy wymagających Origin) — `no-referrer`.
 */
function protectOneTimeResponse(request: NextRequest, response: NextResponse): NextResponse {
  const { pathname } = request.nextUrl;
  if (isOneTimeLinkPath(pathname)) {
    response.headers.set('cache-control', PRIVATE_CACHE_CONTROL);
    response.headers.set('referrer-policy', 'no-referrer');
    response.headers.set('x-robots-tag', 'noindex, nofollow');
  } else if (isPrivateRoutePath(pathname)) {
    response.headers.set('referrer-policy', 'strict-origin');
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

/** Jeden segment z kropką tuż pod korzeniem (`/plik.ext`) — nigdy adres z prefiksem języka. */
const ROOT_DOTTED_SEGMENT_RE = /^\/[^/]*\.[^/]*\/?$/;

const FAQ_RE = /^\/([a-z]{2})\/faq\/?$/;

/**
 * Dawna atrapa `/faq` (treść placeholder) → 308 na `/pomoc` — pytania i odpowiedzi z faktów
 * produktu (#61). W middleware, nie w stronie: przekierowanie z renderu ISR dublowało
 * `Location` (#298). Query zostaje.
 */
function faqRedirect(request: NextRequest): NextResponse | null {
  const match = FAQ_RE.exec(request.nextUrl.pathname);
  const locale = match?.[1];
  const supported: readonly string[] = routing.locales;
  if (!locale || !supported.includes(locale)) return null;
  // Nowy URL, nie `nextUrl.clone()` — klon zachowuje końcowy ukośnik z żądania.
  const url = new URL(`/${locale}/pomoc${request.nextUrl.search}`, request.url);
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

/**
 * Żądanie z nagłówkiem `PANEL_RETURN_PATH_HEADER` = ścieżka strony panelu (albo bez niego) —
 * guard panelu bez sesji kieruje na logowanie z powrotem na tę stronę (#1090). Nagłówek
 * wysłany przez klienta jest zawsze zastępowany. Treść żądania nie jest tu potrzebna
 * (next-intl czyta tylko adres, nagłówki i cookies; dalej idzie oryginalne żądanie
 * z nadpisanymi nagłówkami).
 */
function withPanelReturnPath(request: NextRequest): NextRequest {
  const returnPath = panelReturnPath(request.nextUrl.pathname, request.nextUrl.search);
  if (!returnPath && !request.headers.has(PANEL_RETURN_PATH_HEADER)) return request;
  const headers = new Headers(request.headers);
  headers.delete(PANEL_RETURN_PATH_HEADER);
  if (returnPath) headers.set(PANEL_RETURN_PATH_HEADER, returnPath);
  return new NextRequest(request.url, { method: request.method, headers });
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

  // Anonimowe formularze nie potrzebują globalnych 6 MB Server Actions (CFG29-07): duży POST
  // poza panelami odpada przed renderem i akcją.
  if (isOversizedPublicAction(request.nextUrl.pathname, request.method, request.headers)) {
    return new NextResponse(null, { status: 413, headers: { 'cache-control': PRIVATE_CACHE_CONTROL } });
  }

  const cityRedirect = cityAliasRedirect(request) ?? faqRedirect(request);
  if (cityRedirect) return cityRedirect;

  // 0b) Ścieżka z jednym segmentem z kropką w korzeniu (np. `/brak-takiego-pliku.png`): dawniej
  // omijała middleware (wzorzec `.*\\..*`), więc next-intl jej nie przekierowywał pod prefiks
  // języka, a wielojęzyczny 404 powłoki (`src/app/not-found.tsx`) zostawał na tym adresie (#1035).
  // Bramka hasła i gotowość działają już wyżej; tu tylko zachowujemy stary routing bez i18n.
  if (ROOT_DOTTED_SEGMENT_RE.test(request.nextUrl.pathname)) {
    const passthrough = NextResponse.next();
    protectOneTimeResponse(request, passthrough);
    if (getSiteAccessPassword()) passthrough.headers.set('cache-control', PRIVATE_CACHE_CONTROL);
    return passthrough;
  }

  // 1) next-intl — bazowa odpowiedź (może być redirectem/rewrite z prefiksem locale). next-intl
  // przekazuje nagłówki żądania dalej, więc tu dokładamy ścieżkę strony panelu dla guarda
  // (powrót po logowaniu, #1090); wartość od klienta jest zawsze usuwana.
  const response = handleIntl(withPanelReturnPath(request));
  protectOneTimeResponse(request, response);
  // Serwis za bramką hasła: odpowiedź dla osoby z dostępem nie może trafić do cache współdzielonego.
  if (getSiteAccessPassword()) response.headers.set('cache-control', PRIVATE_CACHE_CONTROL);

  return response;
}

/**
 * Matcher (#1035). Dawny wzorzec `.*\\..*` pomijał middleware dla KAŻDEJ ścieżki z kropką w
 * dowolnym segmencie — także dla `/pl/oferty-pracy/dowolny.slug`, który trafia do tras
 * dynamicznych (`[slug]`), a wraz z nim Server Action z publicznych formularzy. Bramka hasła
 * i tryb „niegotowe” (503) były wtedy omijane. Teraz pomijamy wyłącznie:
 * - katalogi bez stron: `api`, `auth` (dawny callback), `_next`, `_vercel`, `images`,
 *   `.well-known` (granica segmentu, nie prefiks nazwy),
 * - jawnie wymienione pliki z korzenia (`public/` + trasy metadanych) — strażnik
 *   `tests/unit/middleware-matcher.test.ts` pilnuje, że każdy plik z `public/` jest na liście,
 * - pliki sitemap (`/sitemap/<n>.xml`) i manifest per język (`/<dowolny-segment-bez-kropki>/manifest.webmanifest`;
 *   trasa sama zwraca 404 dla nieobsługiwanego języka, bez przekierowania next-intl).
 * Drugi matcher przepuszcza przez middleware każde żądanie Server Action (nagłówek
 * `next-action`), niezależnie od ścieżki — druga linia obrony.
 */
export const config = {
  // Literał (nie składany z zmiennych): Next analizuje `config` statycznie w czasie builda (#1035).
  matcher: [
    '/((?!(?:api|auth|_next|_vercel|images|\\.well-known)(?:/|$)|(?:favicon\\.ico|robots\\.txt|sitemap\\.xml|sw\\.js|offline\\.html|manifest\\.webmanifest|og\\.png|apple-touch-icon\\.png|icon\\.svg|icon-[a-z0-9-]+\\.png)$|sitemap/[0-9]+\\.xml$|[^/.]+/manifest\\.webmanifest$).*)',
    { source: '/:path*', has: [{ type: 'header', key: 'next-action' }] },
  ],
};

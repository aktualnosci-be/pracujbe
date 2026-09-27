import { NextResponse } from "next/server";

import { isLocale, routing, type Locale } from "@/i18n/routing";
import { isProductionMode } from "@/lib/env";
import { captureError } from "@/lib/error-report";
import { AppError, ErrorCodes } from "@/lib/errors";
import { readTextWithLimit } from "@/lib/http/read-limited";
import { trustedClientIp } from "@/lib/http/trusted-ip";
import { checkRateLimit } from "@/lib/rate-limit";
import { withinLocalSiteAccessLimit } from "@/lib/site-access-local-limit";
import {
  SITE_ACCESS_COOKIE,
  SITE_ACCESS_DENIED_PARAM,
  SITE_ACCESS_MAX_AGE,
  constantTimeEqual,
  getSiteAccessPassword,
  pickGateLocale,
  renderSiteAccessPage,
  siteAccessReturnPath,
  siteAccessToken,
} from "@/lib/site-access";

/**
 * Formularz bramki dostępu (patrz `src/lib/site-access.ts`). Poprawne hasło → cookie z HMAC
 * hasła i powrót na żądaną stronę; błędne → powrót z flagą błędu po krótkim opóźnieniu
 * (utrudnia zgadywanie). Hasło nie jest logowane ani odsyłane.
 *
 * Limit prób (#584): każde żądanie (poprawne i błędne) jest liczone przez wspólny limiter
 * (`checkRateLimit`, klucz per zaufany adres IP — patrz `src/lib/rate-limit.ts`), zanim
 * hasło jest w ogóle porównywane. Po przekroczeniu — `429` + `Retry-After`, bez porównania
 * hasła i bez ujawnienia, czy akurat podane hasło jest poprawne.
 *
 * Limit rozmiaru body (#911): formularz ma trzy krótkie pola tekstowe (hasło, `next`, `locale`)
 * — bez plików. `request.formData()` samo w sobie buforuje CAŁE body zanim cokolwiek sprawdzimy
 * (limiter, czy bramka jest w ogóle aktywna), więc duże albo wolno przesyłane żądanie zużywa
 * pamięć/czas procesu przed jakąkolwiek odpowiedzią. `readTextWithLimit` czyta strumień z twardym
 * limitem bajtów (deklarowany `Content-Length` I faktycznie odebrane bajty — działa też bez tego
 * nagłówka) i przerywa, zanim padnie limit; dopiero zmieszczone w limicie body trafia do
 * `formData()` (przez odtworzony `Request` z tym samym `content-type`, więc obsługuje zarówno
 * urlencoded, jak i multipart).
 */

export const dynamic = "force-dynamic";

const FAILURE_DELAY_MS = 750;
const RATE_LIMIT_ACTION = "site-access";
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_SECONDS = 15 * 60;
/** Hasło + `next` (≤ 512 znaków, patrz `safeNextPath`) + `locale` mieszczą się z dużym zapasem. */
const MAX_BODY_BYTES = 4096;

function unavailable(locale: Locale, next: string): Response {
  return new NextResponse(
    renderSiteAccessPage({ locale, next, error: false, unavailable: true }),
    {
      status: 503,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-robots-tag": "noindex,nofollow",
      },
    },
  );
}

function tooManyRequests(locale: Locale, next: string): Response {
  return new NextResponse(
    renderSiteAccessPage({ locale, next, error: false, rateLimited: true }),
    {
      status: 429,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-robots-tag": "noindex,nofollow",
        "retry-after": String(RATE_LIMIT_WINDOW_SECONDS),
      },
    },
  );
}

/** Body ponad `MAX_BODY_BYTES` (#911) — odrzucone przed parsowaniem, bez porównania hasła. */
function payloadTooLarge(locale: Locale, next: string): Response {
  return new NextResponse(
    renderSiteAccessPage({ locale, next, error: false, tooLarge: true }),
    {
      status: 413,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-robots-tag": "noindex,nofollow",
      },
    },
  );
}

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

  // Limit rozmiaru body PRZED parsowaniem formularza (#911) — niezależnie od tego, czy bramka
  // jest aktywna. Body nad limitem nie jest w ogóle sparsowane: bez `next`/`locale` z żądania
  // nie znamy zamierzonego celu ani języka, więc bierzemy je z tych samych sygnałów co strona
  // bramki bez ważnego cookie (`pickGateLocale` — Accept-Language, tu bez prefiksu ścieżki).
  const bodyLimit = await readTextWithLimit(request, MAX_BODY_BYTES);
  if (!bodyLimit.ok) {
    const fallbackLocale = pickGateLocale(
      "/",
      request.headers.get("accept-language"),
    );
    return payloadTooLarge(fallbackLocale, `/${fallbackLocale}`);
  }

  let form: FormData;
  try {
    const contentType = request.headers.get("content-type");
    const reconstructed = new Request("https://pracuj.invalid/api/site-access", {
      method: "POST",
      headers: contentType ? { "content-type": contentType } : undefined,
      body: bodyLimit.text,
    });
    form = await reconstructed.formData();
  } catch {
    form = new FormData();
  }
  const rawLocale = form.get("locale");
  const locale = isLocale(rawLocale) ? rawLocale : routing.defaultLocale;
  const target = siteAccessReturnPath(
    typeof form.get("next") === "string" ? (form.get("next") as string) : null,
    locale,
  );

  // Bramka wyłączona — nic do sprawdzania.
  if (!expected) return redirectTo(target);

  // Limit prób (#584) — przed jakimkolwiek porównaniem hasła (koszt HMAC też jest ograniczony).
  // Klucz limitera = zaufany adres klienta; bez niego nie ma wspólnego klucza (#625).
  if (trustedClientIp(request.headers) === null) {
    if (isProductionMode()) {
      captureError(new AppError(ErrorCodes.SITE_ACCESS_UNAVAILABLE), {
        area: "site-access",
      });
      return unavailable(locale, target);
    }
    if (!withinLocalSiteAccessLimit(RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_SECONDS))
      return tooManyRequests(locale, target);
  } else {
    const withinLimit = await checkRateLimit(RATE_LIMIT_ACTION, {
      max: RATE_LIMIT_MAX,
      windowSeconds: RATE_LIMIT_WINDOW_SECONDS,
    });
    if (!withinLimit) return tooManyRequests(locale, target);
  }

  const password = form.get("password");
  const given = typeof password === "string" ? password.trim() : "";
  const [givenToken, expectedToken] = await Promise.all([
    siteAccessToken(given || "\u0000"),
    siteAccessToken(expected),
  ]);

  if (!given || !constantTimeEqual(givenToken, expectedToken)) {
    await new Promise((resolve) => setTimeout(resolve, FAILURE_DELAY_MS));
    const url = new URL(target, "https://pracuj.invalid");
    url.searchParams.set(SITE_ACCESS_DENIED_PARAM, "denied");
    return redirectTo(`${url.pathname}${url.search}`);
  }

  const response = redirectTo(target);
  response.cookies.set(SITE_ACCESS_COOKIE, expectedToken, {
    httpOnly: true,
    sameSite: "lax",
    secure:
      request.headers.get("x-forwarded-proto") === "https" ||
      new URL(request.url).protocol === "https:",
    path: "/",
    maxAge: SITE_ACCESS_MAX_AGE,
  });
  return response;
}

export function GET(): Response {
  return redirectTo(`/${routing.defaultLocale}`);
}

import { expect, test, type APIResponse } from "@playwright/test";

import { E2E_GA_MEASUREMENT_ID, E2E_META_PIXEL_ID } from "./fixtures/trackers";

/**
 * Regresja #298: strony publiczne bez danych per użytkownik są statyczne/ISR — dostają
 * `s-maxage` i trafiają do cache serwera (`x-nextjs-cache: HIT`) zamiast SSR z `no-store`.
 * Kontrole ujemne: strony zależne od żądania (lista z filtrami, auth, panele) zostają
 * `no-store`, a HTML z cache nie zależy od cookies (sesja, zgody) i nie zawiera trackerów
 * (Invariant #7 — skrypty ładuje dopiero wyspa kliencka po zgodzie).
 */

const STATIC_PAGES: Array<{ path: string; maxAge: number }> = [
  { path: "/pl", maxAge: 60 },
  { path: "/nl/praca", maxAge: 60 },
  { path: "/pl/praca/kategoria/construction", maxAge: 60 },
  { path: "/fr/praca/miasto/brussels", maxAge: 60 },
  { path: "/pl/poradniki", maxAge: 3600 },
  { path: "/en/poradniki/umowa-interim-co-warto-wiedziec", maxAge: 3600 },
  { path: "/pl/dla-pracodawcow", maxAge: 3600 },
  { path: "/pl/regulamin", maxAge: 3600 },
  { path: "/nl/faq", maxAge: 3600 },
];

const PER_REQUEST_PAGES = ["/pl/oferty-pracy", "/pl/logowanie", "/pl/candidate", "/pl/employer"];

/** Cookies, które nie mogą zmienić treści strony z cache: zgoda na wszystko + „sesja”. */
const VISITOR_COOKIES = [
  `pracujbe_consent=${encodeURIComponent(
    JSON.stringify({ necessary: true, analytics: true, marketing: true, preferences: true }),
  )}`,
  "better-auth.session_token=e2e-fake-session",
  "sb-access-token=e2e-fake-session",
].join("; ");

function sMaxAge(response: APIResponse): number | null {
  const match = /(?:^|,)\s*s-maxage=(\d+)/.exec(response.headers()["cache-control"] ?? "");
  return match ? Number(match[1]) : null;
}

async function getTwice(request: import("@playwright/test").APIRequestContext, path: string) {
  await request.get(path, { maxRedirects: 0 });
  return request.get(path, { maxRedirects: 0 });
}

for (const { path, maxAge } of STATIC_PAGES) {
  test(`${path}: statyczna/ISR, cache współdzielony ${maxAge} s, trafienie w cache`, async ({ request }) => {
    const response = await getTwice(request, path);
    expect(response.status()).toBe(200);
    const cacheControl = response.headers()["cache-control"] ?? "";
    expect(cacheControl).not.toContain("no-store");
    expect(cacheControl).not.toContain("private");
    expect(sMaxAge(response)).toBe(maxAge);
    expect(response.headers()["x-nextjs-cache"]).toBe("HIT");
    expect(response.headers()["set-cookie"]).toBeUndefined();
  });
}

test("szczegół oferty: ISR na żądanie (60 s), drugie żądanie z cache", async ({ request }) => {
  const list = await request.get("/pl/oferty-pracy");
  const slug = /href="\/pl\/oferty-pracy\/([a-z0-9-]+)"/.exec(await list.text())?.[1];
  expect(slug, "lista ofert linkuje do szczegółu").toBeTruthy();
  const response = await getTwice(request, `/pl/oferty-pracy/${slug}`);
  expect(response.status()).toBe(200);
  expect(sMaxAge(response)).toBe(60);
  expect(response.headers()["x-nextjs-cache"]).toBe("HIT");
});

test("HTML z cache nie zależy od cookies sesji ani zgód i nie zawiera trackerów", async ({ request }) => {
  for (const path of ["/pl", "/pl/regulamin"]) {
    const anonymous = await getTwice(request, path);
    const withCookies = await request.get(path, { headers: { cookie: VISITOR_COOKIES } });
    expect(withCookies.headers()["x-nextjs-cache"]).toBe("HIT");
    const html = await withCookies.text();
    expect(html).toBe(await anonymous.text());
    // Invariant #7: nawet przy zapisanej zgodzie serwer nie wstawia skryptów GA/Meta.
    expect(html).not.toContain("googletagmanager.com");
    expect(html).not.toContain("connect.facebook.net");
    expect(html).not.toContain(E2E_META_PIXEL_ID);
    expect(html).not.toMatch(new RegExp(`<script[^>]*${E2E_GA_MEASUREMENT_ID}`));
  }
});

for (const path of PER_REQUEST_PAGES) {
  test(`kontrola ujemna ${path}: renderowana per żądanie, bez cache współdzielonego`, async ({ request }) => {
    const response = await getTwice(request, path);
    expect(sMaxAge(response)).toBeNull();
    expect(response.headers()["x-nextjs-cache"]).toBeUndefined();
  });
}

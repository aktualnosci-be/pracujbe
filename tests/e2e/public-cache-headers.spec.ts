import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type APIResponse } from "@playwright/test";

import { E2E_CF_ANALYTICS_TOKEN } from "./fixtures/trackers";

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

/**
 * Odpowiedź z cache ISR. Wpis mógł powstać wcześniej w tym przebiegu (inne testy odwiedzają
 * te strony) i być starszy niż `revalidate` — wtedy Next odpowiada `STALE` i odświeża go
 * w tle, a kolejne żądanie dostaje `HIT` (flaky przy `toBe("HIT")` po dwóch żądaniach, #375).
 * Strona renderowana per żądanie nigdy nie ma nagłówka `x-nextjs-cache`, więc asercja
 * nadal łapie regresję do SSR.
 */
async function getCached(request: import("@playwright/test").APIRequestContext, path: string) {
  let response = await request.get(path, { maxRedirects: 0 });
  await expect
    .poll(
      async () => {
        response = await request.get(path, { maxRedirects: 0 });
        return response.headers()["x-nextjs-cache"];
      },
      { message: `${path}: trafienie w cache ISR` },
    )
    .toBe("HIT");
  return response;
}

for (const { path, maxAge } of STATIC_PAGES) {
  test(`${path}: statyczna/ISR, cache współdzielony ${maxAge} s, trafienie w cache`, async ({ request }) => {
    const response = await getCached(request, path);
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
  const response = await getCached(request, `/pl/oferty-pracy/${slug}`);
  expect(response.status()).toBe(200);
  expect(sMaxAge(response)).toBe(60);
  expect(response.headers()["x-nextjs-cache"]).toBe("HIT");
});

test("HTML z cache nie zależy od cookies sesji ani zgód i nie zawiera trackerów", async ({ request }) => {
  for (const path of ["/pl", "/pl/regulamin"]) {
    const anonymous = await getCached(request, path);
    const withCookies = await request.get(path, { headers: { cookie: VISITOR_COOKIES } });
    expect(withCookies.headers()["x-nextjs-cache"]).toBe("HIT");
    const html = await withCookies.text();
    expect(html).toBe(await anonymous.text());
    // Invariant #7: nawet przy zapisanej zgodzie serwer nie wstawia beaconu (#570) ani GA/Meta.
    expect(html).not.toContain("googletagmanager.com");
    expect(html).not.toContain("connect.facebook.net");
    expect(html).not.toContain("static.cloudflareinsights.com");
    expect(html).not.toMatch(new RegExp(`<script[^>]*${E2E_CF_ANALYTICS_TOKEN}`));
  }
});

/**
 * #298 („Otwarte”): 404 losowych slugów ofert nie trafia na dysk. Domyślny handler Next
 * zapisywał każdy taki wynik (`.html`/`.rsc`/`.meta` w `.next/server/app`) bez limitu; własny
 * cacheHandler (`src/lib/cache/isr-cache-handler.mjs`) trzyma je krótko w małej puli pamięci.
 * Serwer E2E działa na tym samym katalogu `.next`, więc liczymy pliki bezpośrednio.
 */
function countFiles(dir: string): number {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir, { recursive: true }).length;
}

test("seria losowych slugów ofert: 404 z cache, bez nowych plików na dysku", async ({ request }) => {
  // Domyślny handler pisał tu `<slug>.html/.rsc/.meta`; własny nie pisze do katalogu buildu wcale.
  const buildDir = join(process.cwd(), ".next/server/app/pl/oferty-pracy");
  // Katalog runtime handlera: plik = sha256(klucz). Inne testy (równolegle) mogą tu zapisać
  // poprawne strony, więc sprawdzamy wyłącznie pliki kluczy z tej serii.
  const handlerDir = join(process.cwd(), ".next/cache/isr-handler");
  const before = countFiles(buildDir);
  const run = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const paths = Array.from({ length: 40 }, (_, i) => `/pl/oferty-pracy/e2e-losowy-${run}-${i}`);
  for (const path of paths) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status()).toBe(404);
  }
  // Powtórzony slug trafia w krótką pulę 404 w pamięci (bez ponownego renderu).
  const repeated = await request.get(paths[0]!, { maxRedirects: 0 });
  expect(repeated.status()).toBe(404);
  expect(repeated.headers()["x-nextjs-cache"]).toBe("HIT");
  expect(countFiles(buildDir)).toBe(before);
  const handlerFiles = new Set(existsSync(handlerDir) ? readdirSync(handlerDir) : []);
  for (const path of paths) {
    expect(handlerFiles.has(`${createHash("sha256").update(path).digest("hex")}.json`)).toBe(false);
  }
});

for (const path of PER_REQUEST_PAGES) {
  test(`kontrola ujemna ${path}: renderowana per żądanie, bez cache współdzielonego`, async ({ request }) => {
    const response = await getTwice(request, path);
    expect(sMaxAge(response)).toBeNull();
    expect(response.headers()["x-nextjs-cache"]).toBeUndefined();
  });
}

/**
 * #99: lejek ofert liczy wyświetlenia osobnym żądaniem PO załadowaniu, więc strona oferty
 * zostaje w cache ISR. Endpoint nie jest cache'owany, nie ustawia cookies, a zgłoszenie
 * z cookies sesji/zgód nie zmienia HTML strony z cache.
 */
test("lejek ofert: endpoint no-store bez cookies, strona oferty nadal z cache", async ({ request, page }) => {
  const list = await request.get("/pl/oferty-pracy");
  const slug = /href="\/pl\/oferty-pracy\/([a-z0-9-]+)"/.exec(await list.text())?.[1];
  expect(slug, "lista ofert linkuje do szczegółu").toBeTruthy();
  const path = `/pl/oferty-pracy/${slug}`;
  const before = await getCached(request, path);

  const event = {
    event: "detail_view",
    nonce: "5b0f7a1e-2c3d-4e5f-8a9b-0c1d2e3f4a5b",
    jobIds: ["3f1c7a52-6f7e-4d0b-9a55-1a2b3c4d5e6f"],
  };
  const beacon = await request.post("/api/job-funnel", {
    data: event,
    headers: { cookie: VISITOR_COOKIES, "sec-fetch-site": "same-origin" },
  });
  expect(beacon.status()).toBe(204);
  expect(beacon.headers()["cache-control"]).toBe("private, no-store");
  expect(beacon.headers()["set-cookie"]).toBeUndefined();
  expect((await request.get("/api/job-funnel")).status()).toBe(405);
  // Zdarzenie nie przyjmuje dodatkowych danych (np. tekstu wyszukiwania).
  expect((await request.post("/api/job-funnel", { data: { ...event, keyword: "magazyn" } })).status()).toBe(400);

  const after = await request.get(path, { maxRedirects: 0 });
  expect(after.headers()["x-nextjs-cache"]).toBe("HIT");
  expect(sMaxAge(after)).toBe(60);
  expect(after.headers()["set-cookie"]).toBeUndefined();
  expect(await after.text()).toBe(await before.text());

  // Oferty demonstracyjne (dane E2E) nie są zliczane: przeglądarka nie wysyła zgłoszeń
  // ani z listy, ani ze szczegółu, i nie dostaje żadnego cookie od lejka.
  const funnelRequests: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("/api/job-funnel")) funnelRequests.push(req.url());
  });
  await page.goto("/pl/oferty-pracy");
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  expect(funnelRequests).toEqual([]);
});

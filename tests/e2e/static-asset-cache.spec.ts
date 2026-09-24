import { expect, test } from "@playwright/test";

/**
 * Regresja #394: obraz hero z optymalizatora i pliki z public/ mają długi cache, a service
 * worker — nie (aktualizacja nie może utknąć w cache przeglądarki).
 */

function maxAge(cacheControl: string | undefined): number {
  const match = /(?:^|,)\s*max-age=(\d+)/.exec(cacheControl ?? "");
  return match ? Number(match[1]) : 0;
}

test("optymalizowany obraz hero: cache ≥ 30 dni i trafienie w cache serwera", async ({ request }) => {
  const url = "/_next/image?url=%2Fimages%2Fpeople%2Fteam.webp&w=750&q=75";
  const headers = { accept: "image/avif,image/webp,*/*" };
  const first = await request.get(url, { headers });
  expect(first.status()).toBe(200);
  expect(maxAge(first.headers()["cache-control"])).toBeGreaterThanOrEqual(2_592_000);
  const second = await request.get(url, { headers });
  expect(second.headers()["x-nextjs-cache"]).toBe("HIT");
});

for (const path of [
  "/images/people/team.webp",
  "/icon-192.png",
  "/icon-maskable-512.png",
  "/apple-touch-icon.png",
  "/icon.svg",
  "/og.png",
]) {
  test(`plik publiczny ${path}: cache ≥ 1 dzień bez immutable`, async ({ request }) => {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    const cacheControl = response.headers()["cache-control"];
    expect(maxAge(cacheControl)).toBeGreaterThanOrEqual(86_400);
    expect(cacheControl).not.toContain("immutable");
  });
}

test("service worker nie ma długiego cache", async ({ request }) => {
  const response = await request.get("/sw.js");
  expect(response.status()).toBe(200);
  expect(maxAge(response.headers()["cache-control"])).toBe(0);
});

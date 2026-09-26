import { expect, test } from "@playwright/test";

/**
 * #691: dawna atrapa `/faq` nie istnieje — stały adres (zakładki, indeks) dostaje 308 na
 * `/pomoc` w tym samym języku, a strona docelowa odpowiada 200. Wzorzec jak
 * `landing-city-redirect.spec.ts` (przekierowanie w middleware, nie z renderu ISR — #298).
 */

const locales = ["pl", "nl", "fr", "en"] as const;

for (const locale of locales) {
  test(`${locale}: /faq → 308 na /pomoc`, async ({ request, page }) => {
    const response = await request.get(`/${locale}/faq?utm_source=x`, { maxRedirects: 0 });
    expect(response.status()).toBe(308);
    const location = new URL(response.headers()["location"] ?? "", "http://x");
    expect(location.pathname).toBe(`/${locale}/pomoc`);
    expect(location.search).toBe("?utm_source=x");

    const landed = await page.goto(`/${locale}/faq`);
    expect(landed?.status()).toBe(200);
    await expect(page).toHaveURL(new RegExp(`/${locale}/pomoc$`));
  });
}

test("kontrola ujemna: podstrona /faq/… nie przekierowuje na /pomoc", async ({ request }) => {
  const response = await request.get("/pl/faq/cos", { maxRedirects: 0 });
  expect(response.headers()["location"] ?? "").not.toMatch(/\/pomoc$/);
  expect(response.status()).toBe(404);
});

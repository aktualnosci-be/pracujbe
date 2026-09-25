import { expect, test, type Page } from "@playwright/test";

/**
 * Regresja #189 (tryb demo): zbiór ofert miasta nie zależy od języka strony.
 * - zmiana języka na /oferty-pracy?location=Bruksela zachowuje wyniki, a chip i filtr
 *   pokazują nazwę w nowym języku (bez „Bruksela (0)” obok „Brussel”),
 * - landing /praca/miasto/brussels ma ten sam zbiór w PL/NL/FR/EN,
 * - link „wszystkie oferty miasta” prowadzi do tego samego zbioru co landing.
 */

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    {
      name: "pracujbe_consent",
      value: JSON.stringify({
        v: process.env.NEXT_PUBLIC_CONSENT_POLICY_VERSION ?? "2.0",
        categories: { necessary: true, preferences: false, analytics: false },
        ts: "2026-01-01T00:00:00.000Z",
        id: "city-location-locale-e2e",
      }),
      url: "http://localhost:3000",
      sameSite: "Lax",
    },
  ]);
});

/** Identyfikatory ofert widocznych w wynikach (sufiks sluga jest wspólny dla języków). */
async function jobIds(page: Page): Promise<string[]> {
  const hrefs = await page
    .locator("main a[href*='/oferty-pracy/']")
    .evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
  const ids = hrefs
    .map((href) => /\/oferty-pracy\/[^?#/]+-(\d+)$/.exec(href)?.[1])
    .filter((id): id is string => Boolean(id));
  return [...new Set(ids)].sort();
}

test("zmiana języka z ?location=Bruksela nie zmienia zbioru ofert", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const query = "location=Bruksela&category=construction&sort=salary";
  await page.goto(`/pl/oferty-pracy?${query}`);
  const plIds = await jobIds(page);
  expect(plIds.length).toBeGreaterThan(0);

  await page.locator("footer").getByRole("combobox", { name: "Język" }).click();
  await page.getByRole("option", { name: "Nederlands" }).click();
  await expect(page).toHaveURL(new RegExp(`/nl/oferty-pracy\\?${query}$`));

  expect(await jobIds(page)).toEqual(plIds);
  const sidebar = page.locator("aside");
  await expect(sidebar.getByRole("checkbox", { name: /Brussel/ })).toBeChecked();
  await expect(sidebar.getByRole("checkbox", { name: /Bruksela/ })).toHaveCount(0);
});

test("landing Brukseli: ten sam zbiór w każdym języku i w „wszystkie oferty miasta”", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const perLocale: Record<string, string[]> = {};
  for (const locale of ["pl", "nl", "fr", "en"]) {
    await page.goto(`/${locale}/praca/miasto/brussels`);
    perLocale[locale] = await jobIds(page);
  }
  expect(perLocale.pl!.length).toBeGreaterThan(0);
  for (const locale of ["nl", "fr", "en"]) expect(perLocale[locale]).toEqual(perLocale.pl);

  // „Wszystkie oferty miasta” z polskiego landingu, otwarte po niderlandzku.
  await page.goto("/pl/praca/miasto/brussels");
  const seeAll = page.locator("main a[href*='/oferty-pracy?']").first();
  const href = (await seeAll.getAttribute("href"))!;
  await page.goto(href.replace(/^\/pl\//, "/nl/"));
  const listIds = await jobIds(page);
  expect(listIds).toEqual(expect.arrayContaining(perLocale.pl!));
});

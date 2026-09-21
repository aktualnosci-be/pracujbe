import { expect, test } from "@playwright/test";

// Karta musi zachować czytelność i działający link także na wąskim ekranie.
for (const locale of ["pl", "nl", "fr", "en"]) {
  test(`paszport oferty: ${locale}, ekran 320 px`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`/${locale}/oferty-pracy`);
    const card = page
      .locator("article")
      .filter({ has: page.locator('a[href*="/oferty-pracy/"]') })
      .first();
    await expect(card).toBeVisible();
    await expect(card.locator("dl")).toBeVisible();
    expect(await card.locator("dt").count()).toBeGreaterThanOrEqual(2);
    const fits = await card.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return (
        bounds.left >= 0 &&
        bounds.right <= window.innerWidth &&
        element.scrollWidth <= element.clientWidth
      );
    });
    expect(fits).toBe(true);
    await card.getByRole("heading").getByRole("link").click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/oferty-pracy/.+`));
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
}

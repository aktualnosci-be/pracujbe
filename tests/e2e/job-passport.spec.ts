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
    // Tryb demonstracyjny nie potwierdza zapisu na prawdziwym koncie.
    await expect(card.getByRole("button")).toBeDisabled();
    await expect(card.getByRole("button")).not.toHaveAttribute("aria-pressed", "true");
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

test('rzeczywista karta demo pokazuje miesięczny okres także na detalu', async ({ page }) => {
  await page.goto('/pl/oferty-pracy');
  const card = page.locator('article').filter({ hasText: 'Magazynier' }).first();
  await expect(card).toBeVisible();
  await expect(card.getByText(/brutto \/ mies\./)).toBeVisible();
  const detailLink = card.getByRole('heading').getByRole('link');
  const detailHref = await detailLink.getAttribute('href');
  expect(detailHref).toBeTruthy();
  const detailUrl = new URL(detailHref!, page.url()).href;
  await detailLink.click();
  await expect(page).toHaveURL(detailUrl);
  await expect(page.getByRole('heading', { level: 1, name: /Magazynier/ })).toBeVisible();
  await expect(page.getByText(/brutto \/ mies\./).first()).toBeVisible();
  await expect(page.getByText(/brutto \/ godz\./)).toHaveCount(0);

  const jsonLd = (await page.locator('script[type="application/ld+json"]').allTextContents())
    .map(raw => JSON.parse(raw) as { '@type'?: string; baseSalary?: { value?: { unitText?: string } } })
    .find(item => item['@type'] === 'JobPosting');
  expect(jsonLd?.baseSalary?.value?.unitText).toBe('MONTH');
});

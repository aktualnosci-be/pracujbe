import { expect, test, type BrowserContext } from '@playwright/test';

/**
 * #216 — na desktopie panel filtrów był wyższy niż viewport i przyklejony (sticky), więc dolne
 * sekcje i przycisk „Pokaż N ofert” pojawiały się dopiero pod ostatnią kartą oferty.
 * Test sprawdza zachowanie: w połowie listy wyników zatwierdzenie jest widoczne, a ostatnia
 * sekcja (data dodania) jest osiągalna bez przewijania strony do stopki.
 */

async function acceptNecessaryCookies(
  context: BrowserContext,
  baseURL: string,
): Promise<void> {
  await context.addCookies([
    {
      name: 'pracujbe_consent',
      value: JSON.stringify({
        v: process.env.NEXT_PUBLIC_CONSENT_POLICY_VERSION ?? '2.0',
        categories: {
          necessary: true,
          preferences: false,
          analytics: false,
          marketing: false,
        },
        ts: '2026-01-01T00:00:00.000Z',
        id: 'jobs-list-sidebar-e2e',
      }),
      url: baseURL,
      sameSite: 'Lax',
    },
  ]);
}

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 1024, height: 700 },
]) {
  test(`zatwierdzenie i dolne filtry osiągalne w połowie listy: ${viewport.width}x${viewport.height}`, async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({ viewport });
    await acceptNecessaryCookies(context, baseURL ?? 'http://localhost:3000');
    const page = await context.newPage();
    await page.goto('/pl/oferty-pracy');

    const rail = page.locator('[data-filter-passport="desktop"]');
    const apply = rail.getByRole('button', { name: /^Pokaż \d/ });
    await expect(apply).toBeVisible();

    // Przewiń stronę do połowy listy wyników (wyraźnie przed stopką).
    const cards = page.locator('main ul > li');
    expect(await cards.count()).toBeGreaterThanOrEqual(6);
    await cards.nth(5).scrollIntoViewIfNeeded();
    const scrollY = await page.evaluate(() => window.scrollY);
    const maxScroll = await page.evaluate(
      () => document.documentElement.scrollHeight - window.innerHeight,
    );
    expect(scrollY).toBeGreaterThan(0);
    expect(scrollY).toBeLessThan(maxScroll - 400);

    await expect(apply).toBeInViewport({ ratio: 1 });

    // Ostatnia sekcja filtrów da się osiągnąć przewijaniem wewnątrz panelu, bez ruszania strony.
    const dateSelect = rail.getByRole('combobox');
    await dateSelect.scrollIntoViewIfNeeded();
    await expect(dateSelect).toBeInViewport({ ratio: 1 });
    await expect(apply).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => window.scrollY)).toBeLessThan(
      maxScroll - 400,
    );

    // Zatwierdzenie nadal działa.
    await rail.getByRole('checkbox', { name: 'Budownictwo' }).click();
    await expect(apply).toBeEnabled();
    await apply.click();
    await expect(page).toHaveURL(/category=construction/);
    await context.close();
  });
}

import { expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * #220 — licznik ofert (`/api/job-filter-facets`) jest tylko podpowiedzią. Jego awaria lub
 * wolna odpowiedź nie może blokować zatwierdzania filtrów na desktopie ani w mobilnym dialogu.
 */

async function acceptNecessaryCookies(
  context: BrowserContext,
  baseURL: string,
): Promise<void> {
  await context.addCookies([
    {
      name: 'pracujbe_consent',
      value: JSON.stringify({
        v: process.env.NEXT_PUBLIC_CONSENT_POLICY_VERSION ?? '1.0',
        categories: {
          necessary: true,
          preferences: false,
          analytics: false,
          marketing: false,
        },
        ts: '2026-01-01T00:00:00.000Z',
        id: 'jobs-list-facets-e2e',
      }),
      url: baseURL,
      sameSite: 'Lax',
    },
  ]);
}

type Failure = 'error' | 'slow';

async function breakFacets(page: Page, failure: Failure): Promise<void> {
  await page.route('**/api/job-filter-facets**', async (route) => {
    if (failure === 'error') {
      await route.fulfill({ status: 500, body: 'unavailable' });
      return;
    }
    // Wolna odpowiedź: dłuższa niż cały test, żeby licznik nigdy nie zdążył.
    await new Promise((resolve) => setTimeout(resolve, 30_000));
    await route.abort();
  });
}

for (const failure of ['error', 'slow'] as const) {
  test(`desktop: zatwierdzenie filtra działa przy liczniku ${failure}`, async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    await acceptNecessaryCookies(context, baseURL ?? 'http://localhost:3000');
    const page = await context.newPage();
    await breakFacets(page, failure);
    await page.goto('/en/oferty-pracy');

    const rail = page.locator('[data-filter-passport="desktop"]');
    await rail.getByRole('checkbox', { name: 'Construction' }).click();
    // Przycisk zatwierdzenia (niezależnie od etykiety) — bez fałszywej liczby, ale aktywny.
    const apply = rail.locator('button[aria-busy]');
    await expect(apply).toBeVisible();
    await expect(apply).not.toHaveText(/\d/);
    await expect(apply).toBeEnabled();
    await apply.click();
    await expect(page).toHaveURL(/[?&]category=construction(?:&|$)/);
    await context.close();
  });

  test(`mobile: zatwierdzenie filtra działa przy liczniku ${failure}`, async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 320, height: 700 },
      hasTouch: true,
    });
    await acceptNecessaryCookies(context, baseURL ?? 'http://localhost:3000');
    const page = await context.newPage();
    await breakFacets(page, failure);
    await page.goto('/en/oferty-pracy');

    await page.locator('[data-filter-passport="mobile-trigger"]').click();
    const sheet = page.getByRole('dialog');
    await sheet.getByRole('checkbox', { name: 'Construction' }).click();
    const apply = sheet.locator('button[aria-busy]');
    await expect(apply).not.toHaveText(/\d/);
    await expect(apply).toBeEnabled();
    await apply.click();
    await expect(page).toHaveURL(/[?&]category=construction(?:&|$)/);
    await context.close();
  });
}

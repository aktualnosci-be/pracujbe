import { expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * #224 — po zatwierdzeniu filtrów fokus klawiatury trafiał na `<body>` (użytkownik wracał na
 * początek strony), lista wyników nie miała nagłówka H2, a dialog filtrów otwierał się z
 * fokusem na akcji „Wyczyść wszystko”.
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
        },
        ts: '2026-01-01T00:00:00.000Z',
        id: 'jobs-list-results-focus-e2e',
      }),
      url: baseURL,
      sameSite: 'Lax',
    },
  ]);
}

async function focusedElement(page: Page) {
  return page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    return {
      tag: active?.tagName ?? null,
      text: active?.textContent?.trim() ?? '',
    };
  });
}

test('mobile: po zatwierdzeniu filtrów klawiaturą fokus jest na nagłówku wyników', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    viewport: { width: 320, height: 700 },
  });
  await acceptNecessaryCookies(context, baseURL ?? 'http://localhost:3000');
  const page = await context.newPage();
  await page.goto('/en/oferty-pracy');

  await expect(
    page.getByRole('heading', { level: 2, name: /jobs? found/ }),
  ).toBeVisible();

  const trigger = page.locator('[data-filter-passport="mobile-trigger"]');
  await trigger.focus();
  await page.keyboard.press('Enter');
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();

  // Fokus początkowy nie jest na akcji czyszczącej wybór.
  const initial = await focusedElement(page);
  expect(initial.text).not.toBe('Clear all');

  const construction = sheet.getByRole('checkbox', { name: 'Construction' });
  await construction.focus();
  await page.keyboard.press('Space');
  await expect(construction).toBeChecked();

  const apply = sheet.locator('button[aria-busy]');
  await expect(apply).toHaveText(/^Show \d+/);
  await apply.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/category=construction/);

  const heading = page.getByRole('heading', { level: 2, name: /jobs? found/ });
  await expect(heading).toBeFocused();
  await context.close();
});

test('desktop: po zatwierdzeniu filtrów fokus jest na nagłówku wyników', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  await acceptNecessaryCookies(context, baseURL ?? 'http://localhost:3000');
  const page = await context.newPage();
  await page.goto('/en/oferty-pracy');

  const rail = page.locator('[data-filter-passport="desktop"]');
  const construction = rail.getByRole('checkbox', { name: 'Construction' });
  await construction.focus();
  await page.keyboard.press('Space');
  const apply = rail.locator('button[aria-busy]');
  await expect(apply).toHaveText(/^Show \d+/);
  await apply.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/category=construction/);

  const heading = page.getByRole('heading', { level: 2, name: /jobs? found/ });
  await expect(heading).toBeFocused();
  expect((await focusedElement(page)).tag).toBe('H2');
  await context.close();
});

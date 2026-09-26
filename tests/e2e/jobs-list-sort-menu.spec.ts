import { expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * #233 — menu sortowania: Escape i kliknięcie poza menu je zamykają, bieżąca opcja ma
 * `aria-current`, a na mobile cele paska wyników (sortowanie, chipy, „Wyczyść filtry”) mają co najmniej 44 px.
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
        id: 'jobs-list-sort-e2e',
      }),
      url: baseURL,
      sameSite: 'Lax',
    },
  ]);
}

function visibleSortMenu(page: Page) {
  return page.locator('details:visible').filter({
    has: page.locator('summary', { hasText: 'Sort by' }),
  });
}

test('Escape i kliknięcie poza menu zamykają sortowanie, fokus wraca na przycisk', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  await acceptNecessaryCookies(context, baseURL ?? 'http://localhost:3000');
  const page = await context.newPage();
  await page.goto('/en/oferty-pracy?sort=salary');

  const menu = visibleSortMenu(page);
  const summary = menu.locator('summary');
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(menu).toHaveAttribute('open', '');

  const current = menu.locator('a[aria-current="true"]');
  await expect(current).toHaveCount(1);
  await expect(current).toHaveText('Highest salary');

  await page.keyboard.press('Tab');
  await page.keyboard.press('Escape');
  await expect(menu).not.toHaveAttribute('open', '');
  await expect(summary).toBeFocused();

  await summary.click();
  await expect(menu).toHaveAttribute('open', '');
  await page.mouse.click(5, 700);
  await expect(menu).not.toHaveAttribute('open', '');

  // Wybór opcji (nawigacja kliencka) zamyka menu nad nowymi wynikami.
  await summary.click();
  await menu.getByRole('link', { name: 'Newest' }).click();
  await expect(page).not.toHaveURL(/sort=salary/);
  await expect(visibleSortMenu(page)).not.toHaveAttribute('open', '');
  await context.close();
});

test('na 320 px sortowanie, chipy i „Wyczyść filtry” mają co najmniej 44 px wysokości', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    viewport: { width: 320, height: 800 },
  });
  await acceptNecessaryCookies(context, baseURL ?? 'http://localhost:3000');
  const page = await context.newPage();
  await page.goto('/en/oferty-pracy?category=construction');

  const menu = visibleSortMenu(page);
  const summary = menu.locator('summary');
  expect((await summary.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await summary.click();
  for (const option of await menu.locator('a').all()) {
    expect((await option.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(
      44,
    );
  }
  await page.keyboard.press('Escape');

  const clear = page.getByRole('link', { name: 'Clear filters', exact: true });
  expect((await clear.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

  // Chipy aktywnych filtrów to też cele dotykowe paska wyników (po #230 łamią długie słowa).
  const chips = page.getByRole('link', { name: /^Remove filter: / });
  await expect(chips.first()).toBeVisible();
  for (const chip of await chips.all()) {
    expect((await chip.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  await context.close();
});

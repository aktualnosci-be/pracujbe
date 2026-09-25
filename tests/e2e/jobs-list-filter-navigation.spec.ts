import { readFileSync } from 'fs';
import { resolve } from 'path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * #222 — po zatwierdzeniu filtrów nawigacja (RSC) może trwać. W tym czasie przycisk
 * zatwierdzenia jest zablokowany i ma `aria-busy=true`, stan ładowania jest ogłaszany,
 * a kolejne kliknięcia nie wywołują drugiej nawigacji. Dotyczy panelu desktopowego
 * i mobilnego dialogu (tam stan niesie wyzwalacz, na który wraca fokus).
 */

const locales = ['pl', 'nl', 'fr', 'en'] as const;
type Locale = (typeof locales)[number];

const RSC_DELAY_MS = 4_000;

function resultsLoading(locale: Locale): string {
  const messages = JSON.parse(
    readFileSync(resolve(process.cwd(), 'src', 'messages', `${locale}.json`), 'utf-8'),
  ) as { filters: { resultsLoading: string } };
  return messages.filters.resultsLoading;
}

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
        id: 'jobs-list-filter-navigation-e2e',
      }),
      url: baseURL,
      sameSite: 'Lax',
    },
  ]);
}

/** Opóźnia nawigacje RSC listy ofert z filtrami i zlicza je (bez prefetchy). */
async function delayFilteredNavigations(page: Page): Promise<() => number> {
  let navigations = 0;
  await page.route('**/oferty-pracy?**', async (route) => {
    const headers = route.request().headers();
    if (headers['rsc'] && !headers['next-router-prefetch']) {
      navigations += 1;
      await new Promise((done) => setTimeout(done, RSC_DELAY_MS));
    }
    await route.continue();
  });
  return () => navigations;
}

for (const locale of locales) {
  test(`${locale}: desktop blokuje zatwierdzenie filtrów w trakcie ładowania wyników`, async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await acceptNecessaryCookies(context, baseURL ?? 'http://localhost:3000');
    const page = await context.newPage();
    await page.goto(`/${locale}/oferty-pracy`);
    const navigations = await delayFilteredNavigations(page);

    const rail = page.locator('[data-filter-passport="desktop"]');
    await rail.getByRole('checkbox').first().click();
    const apply = rail.locator('[data-filter-apply="desktop"]');
    await expect(apply).toHaveAttribute('aria-busy', 'false');
    await apply.click();

    await expect(apply).toHaveAttribute('aria-busy', 'true', { timeout: 1_200 });
    await expect(apply).toBeDisabled();
    await expect(apply).toBeFocused();
    await expect(rail.locator('[data-filter-status="desktop"]')).toHaveText(resultsLoading(locale));

    // Kolejne kliknięcia (także „Wyczyść wszystko”) nie startują drugiej nawigacji.
    await apply.click({ force: true });
    await apply.click({ force: true });
    await rail.locator('[data-filter-target="clear"]').click({ force: true });

    await expect(page).toHaveURL(/[?&]category=/, { timeout: RSC_DELAY_MS * 3 });
    await expect(apply).toHaveAttribute('aria-busy', 'false', { timeout: RSC_DELAY_MS * 3 });
    await expect(apply).toBeEnabled();
    await expect(rail.locator('[data-filter-status="desktop"]')).toHaveText('');
    expect(navigations()).toBe(1);
    await context.close();
  });
}

test('mobile: wyzwalacz filtrów niesie stan ładowania i nie otwiera arkusza ponownie', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 800 },
    hasTouch: true,
  });
  await acceptNecessaryCookies(context, baseURL ?? 'http://localhost:3000');
  const page = await context.newPage();
  await page.goto('/pl/oferty-pracy');
  const navigations = await delayFilteredNavigations(page);

  const trigger = page.locator('[data-filter-passport="mobile-trigger"]');
  await trigger.click();
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('checkbox').first().click();
  await sheet.locator('button[aria-busy]').click();

  await expect(sheet).toBeHidden();
  await expect(trigger).toHaveAttribute('aria-busy', 'true', { timeout: 1_200 });
  await expect(trigger).toBeDisabled();
  await expect(page.locator('[data-filter-status="mobile"]')).toHaveText(
    resultsLoading('pl'),
  );

  // Ponowne otwarcie w trakcie ładowania jest zablokowane (brak drugiego zatwierdzenia).
  await trigger.click({ force: true });
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await expect(page).toHaveURL(/[?&]category=/, { timeout: RSC_DELAY_MS * 3 });
  await expect(trigger).toHaveAttribute('aria-busy', 'false', { timeout: RSC_DELAY_MS * 3 });
  await expect(trigger).toBeEnabled();
  expect(navigations()).toBe(1);
  await context.close();
});

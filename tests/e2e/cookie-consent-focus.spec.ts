import { readFileSync } from 'fs';
import { resolve } from 'path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * #212 — po zamknięciu banera lub centrum zgód fokus nie może trafić na <body> (WCAG 2.4.3).
 * (a) „Dostosuj” → Escape: fokus wraca na „Dostosuj”; po zapisaniu z centrum (baner znika)
 *     fokus trafia na główną treść.
 * (b) „Tylko niezbędne” w banerze: baner znika, fokus na #main-content.
 * (c) Stopka „Ustawienia cookie” → Escape albo „Zapisz ustawienia”: fokus wraca na przycisk.
 */

const LOCALES = ['pl', 'nl', 'fr', 'en'] as const;
type Locale = (typeof LOCALES)[number];

const BANNER = '[aria-labelledby="cookie-banner-title"]';

type Labels = {
  customize: string;
  rejectOptional: string;
  save: string;
  footerSettings: string;
};

function labels(locale: Locale): Labels {
  const messages = JSON.parse(
    readFileSync(resolve(process.cwd(), 'src', 'messages', `${locale}.json`), 'utf-8'),
  ) as {
    cookies: { customize: string; rejectOptional: string; save: string };
    footer: { cookieSettings: string };
  };
  return { ...messages.cookies, footerSettings: messages.footer.cookieSettings };
}

async function storeNecessaryConsent(context: BrowserContext, baseURL: string): Promise<void> {
  await context.addCookies([
    {
      name: 'pracujbe_consent',
      value: JSON.stringify({
        v: process.env.NEXT_PUBLIC_CONSENT_POLICY_VERSION ?? '1.0',
        categories: { necessary: true, preferences: false, analytics: false, marketing: false },
        ts: '2026-01-01T00:00:00.000Z',
        id: 'cookie-consent-focus-e2e',
      }),
      url: baseURL,
      sameSite: 'Lax',
    },
  ]);
}

async function activeTag(page: Page): Promise<string> {
  return page.evaluate(() => document.activeElement?.tagName ?? 'NONE');
}

test.use({ viewport: { width: 1280, height: 800 } });

for (const locale of LOCALES) {
  const l = labels(locale);

  test(`${locale} (a): Escape w centrum zgód oddaje fokus na „Dostosuj”`, async ({ page }) => {
    await page.goto(`/${locale}`);
    const banner = page.locator(BANNER);
    const customize = banner.getByRole('button', { name: l.customize, exact: true });
    await customize.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(customize).toBeFocused();
  });

  test(`${locale} (a): zapis z centrum otwartego z banera → fokus na treści`, async ({ page }) => {
    await page.goto(`/${locale}`);
    const banner = page.locator(BANNER);
    await banner.getByRole('button', { name: l.customize, exact: true }).focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: l.save, exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(banner).toHaveCount(0);
    await expect(page.locator('#main-content')).toBeFocused();
  });

  test(`${locale} (b): „Tylko niezbędne” w banerze → fokus na #main-content`, async ({ page }) => {
    await page.goto(`/${locale}`);
    const banner = page.locator(BANNER);
    await banner.getByRole('button', { name: l.rejectOptional, exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(banner).toHaveCount(0);
    await expect(page.locator('#main-content')).toBeFocused();
    expect(await activeTag(page)).not.toBe('BODY');
  });

  test(`${locale} (c): centrum ze stopki oddaje fokus na przycisk w stopce`, async ({
    page,
    context,
    baseURL,
  }) => {
    await storeNecessaryConsent(context, baseURL ?? 'http://localhost:3000');
    await page.goto(`/${locale}`);
    const footerButton = page
      .locator('footer')
      .getByRole('button', { name: l.footerSettings, exact: true });
    const dialog = page.getByRole('dialog');

    await footerButton.focus();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(footerButton).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: l.save, exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(dialog).toHaveCount(0);
    await expect(footerButton).toBeFocused();
  });
}

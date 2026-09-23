import { expect, test } from '@playwright/test';
import { routing } from '../../src/i18n/routing';
import pl from '../../src/messages/pl.json';
import nl from '../../src/messages/nl.json';
import fr from '../../src/messages/fr.json';
import en from '../../src/messages/en.json';

const messages = { pl, nl, fr, en };

for (const locale of routing.locales) {
  test(`strona ${locale} podłącza własny manifest i otwiera ten sam język`, async ({ page, request }) => {
    await page.goto(`/${locale}`);
    const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(manifestHref).toBe(`/${locale}/manifest.webmanifest`);

    const response = await request.get(manifestHref!);
    expect(response.ok()).toBe(true);
    expect(response.headers()['content-type']).toContain('application/manifest+json');
    const manifest = await response.json();
    expect(manifest).toMatchObject({
      id: '/pl',
      name: messages[locale].common.appName,
      lang: locale,
      start_url: `/${locale}`,
      description: messages[locale].metadata.homeDescription,
    });

    await page.goto(manifest.start_url);
    expect(await page.locator('html').getAttribute('lang')).toBe(locale);
    for (const icon of manifest.icons) {
      const iconResponse = await request.get(icon.src);
      expect(iconResponse.ok(), icon.src).toBe(true);
      expect(iconResponse.headers()['content-type'], icon.src).toContain('image/png');
    }
  });
}

test('nieobsługiwany język nie dostaje błędnego manifestu', async ({ request }) => {
  const response = await request.get('/xx/manifest.webmanifest', { maxRedirects: 0 });
  expect(response.status()).toBe(404);
});

test('dotychczasowy adres manifestu nadal obsługuje polskie instalacje', async ({ request }) => {
  const response = await request.get('/manifest.webmanifest');
  expect(response.ok()).toBe(true);
  expect(await response.json()).toMatchObject({ lang: 'pl', start_url: '/pl', id: '/pl' });
});

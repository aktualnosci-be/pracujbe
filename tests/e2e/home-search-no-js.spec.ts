import { readFileSync } from 'fs';
import { resolve } from 'path';
import { expect, test, type Page } from '@playwright/test';

/**
 * #815 — wyszukiwarka na stronie głównej (`HeroSearch`) musi działać jako natywny formularz GET,
 * bo bez JavaScriptu przeglądarka wysyła jego aktywne, nazwane pola (`keyword`/`city`) na adres
 * bieżącego dokumentu (algorytm wysyłki formularza HTML — brak `action`/`method` = GET na `/{locale}`,
 * strona główna nie czyta `searchParams`). Formularz ma teraz zlokalizowane `action="/{locale}/oferty-pracy"`
 * i `method="get"`, tak samo jak wyszukiwarka na liście ofert (`tests/e2e/jobs-list-header.spec.ts`).
 */

const locales = ['pl', 'nl', 'fr', 'en'] as const;

type Locale = (typeof locales)[number];

type Messages = {
  home: {
    searchWhatLabel: string;
    searchWhereLabel: string;
    searchButton: string;
  };
  jobs: {
    pageTitle: string;
  };
};

function messages(locale: Locale): Messages {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), 'src', 'messages', `${locale}.json`), 'utf-8'),
  ) as Messages;
}

async function heroSearch(page: Page) {
  return page.getByRole('search').filter({ has: page.locator('#hero-keyword') });
}

for (const locale of locales) {
  test(`wyszukiwarka na stronie głównej bez JavaScriptu prowadzi do listy ofert z filtrami: ${locale}`, async ({
    browser,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 375, height: 900 } });
    const page = await context.newPage();
    const t = messages(locale);

    await page.goto(`/${locale}`);

    const search = await heroSearch(page);
    const keyword = search.getByLabel(t.home.searchWhatLabel, { exact: true });
    const city = search.getByLabel(t.home.searchWhereLabel, { exact: true });
    const submit = search.getByRole('button', { name: t.home.searchButton, exact: true });

    await expect(keyword).toBeVisible();
    await expect(city).toBeVisible();

    await keyword.fill('magazynier');
    await city.fill('Gandawa');

    await Promise.all([
      page.waitForURL(
        (target) =>
          target.pathname === `/${locale}/oferty-pracy` &&
          target.searchParams.get('keyword') === 'magazynier' &&
          target.searchParams.get('city') === 'Gandawa',
        { waitUntil: 'load' },
      ),
      submit.click(),
    ]);

    await expect(page.getByRole('heading', { level: 1, name: t.jobs.pageTitle })).toBeVisible();

    await context.close();
  });
}

test('kontrola ujemna: bez action/method formularz wraca na stronę główną zamiast na listę ofert', async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 375, height: 900 } });
  const page = await context.newPage();
  const t = messages('pl');

  await page.goto('/pl');

  // Odtwarzamy błąd sprzed naprawy: formularz bez `action`/`method` wysyła GET na adres
  // bieżącego dokumentu (algorytm HTML), więc pola trafiają w query strony głównej.
  await page.evaluate(() => {
    const form = document.querySelector('#hero-keyword')?.closest('form');
    form?.removeAttribute('action');
    form?.removeAttribute('method');
  });

  const search = await heroSearch(page);
  await search.getByLabel(t.home.searchWhatLabel, { exact: true }).fill('magazynier');
  await search.getByRole('button', { name: t.home.searchButton, exact: true }).click();

  await page.waitForURL((target) => target.searchParams.get('keyword') === 'magazynier', { waitUntil: 'load' });
  expect(new URL(page.url()).pathname).toBe('/pl');
  await expect(page.getByRole('heading', { level: 1, name: t.jobs.pageTitle })).toHaveCount(0);

  await context.close();
});

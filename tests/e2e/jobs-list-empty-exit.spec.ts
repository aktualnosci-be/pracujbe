import { readFileSync } from 'fs';
import { resolve } from 'path';
import { expect, test } from '@playwright/test';

/**
 * #228 — pusty wynik musi mieć działającą drogę wyjścia, a numer strony spoza zakresu nie może
 * pokazywać sprzecznego stanu („Znaleziono 26 ofert” + pusta lista + „zmień filtry”).
 */

type Messages = {
  filters: { clearAll: string; clear: string };
  jobs: { empty: string; paginationLabel: string };
};

function messages(locale: string): Messages {
  return JSON.parse(
    readFileSync(
      resolve(process.cwd(), 'src', 'messages', `${locale}.json`),
      'utf-8',
    ),
  ) as Messages;
}

const cards = 'main ul.divide-y > li';

for (const locale of ['pl', 'en'] as const) {
  test(`pusty wynik samego słowa kluczowego ma działający reset: ${locale}`, async ({
    page,
  }) => {
    const t = messages(locale);
    await page.goto(`/${locale}/oferty-pracy?keyword=zzzzqqq&sort=salary`);
    await expect(page.getByText(t.jobs.empty)).toBeVisible();

    // Link „Wyczyść filtry” przy chipach nie może prowadzić na ten sam adres.
    const clear = page.getByRole('link', { name: t.filters.clear, exact: true });
    const clearHref = await clear.getAttribute('href');
    expect(clearHref).not.toContain('keyword=');

    const reset = page.getByRole('link', {
      name: t.filters.clearAll,
      exact: true,
    });
    await expect(reset).toBeVisible();
    await reset.click();
    await expect(page).not.toHaveURL(/keyword=/);
    await expect(page).toHaveURL(/sort=salary/);
    await expect(page.getByText(t.jobs.empty)).toHaveCount(0);
    expect(await page.locator(cards).count()).toBeGreaterThan(0);
  });
}

test('numer strony spoza zakresu prowadzi do ostatniej strony z tymi samymi filtrami', async ({
  page,
}) => {
  const t = messages('pl');
  await page.goto('/pl/oferty-pracy?page=999&sort=salary');
  await expect(page).toHaveURL(/sort=salary/);
  const url = new URL(page.url());
  const landed = Number(url.searchParams.get('page') ?? '1');
  expect(landed).toBeLessThan(999);
  await expect(page.getByText(t.jobs.empty)).toHaveCount(0);
  expect(await page.locator(cards).count()).toBeGreaterThan(0);
  await expect(page.getByRole('navigation', { name: t.jobs.paginationLabel }).locator('[aria-current="page"]')).toHaveText(
    String(landed),
  );
});

test('numer strony przy pustym wyniku pokazuje spójny stan pusty z resetem', async ({
  page,
}) => {
  const t = messages('pl');
  await page.goto('/pl/oferty-pracy?keyword=zzzzqqq&page=5');
  await expect(page.getByText(t.jobs.empty)).toBeVisible();
  await expect(page.getByRole('navigation', { name: t.jobs.paginationLabel }).locator('[aria-current="page"]')).toHaveCount(0);
  await expect(
    page.getByRole('link', { name: t.filters.clearAll, exact: true }),
  ).toBeVisible();
});

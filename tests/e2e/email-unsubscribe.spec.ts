import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { createUnsubscribeToken, UNSUBSCRIBE_TOKEN_TTL_SECONDS } from '../../src/lib/email/unsubscribe-token';
import { clickCookieBanner, LOCALES, messages } from './fixtures/messages';
import { E2E_UNSUBSCRIBE_SECRET } from './fixtures/unsubscribe';

/**
 * #45/#505 — strona wypisania `/{locale}/wypisz#t=<token>` i endpoint one-click.
 *
 * Serwer E2E działa bez bazy (tryb demo): GET strony tylko weryfikuje podpis i pokazuje
 * przycisk; wysłanie formularza w demo kończy się komunikatem „niedostępne" (bez udawanego
 * sukcesu). Zapis w bazie i idempotencję dowodzą `rls.sql` (UN45) i testy jednostkowe.
 */

const PROFILE = '8f2c1d3e-4b5a-4c6d-8e7f-901234567890';

type UnsubscribeMessages = {
  title: string;
  confirmText: string;
  confirmButton: string;
  allButton: string;
  invalidTitle: string;
  expiredTitle: string;
  unavailableText: string;
  category: Record<string, string>;
};

function copy(locale: string): UnsubscribeMessages {
  return (messages(locale) as unknown as { emailUnsubscribe: UnsubscribeMessages }).emailUnsubscribe;
}

const token = (category: 'offers' | 'marketing' = 'offers', now = Date.now()) =>
  createUnsubscribeToken({ profileId: PROFILE, category }, E2E_UNSUBSCRIBE_SECRET, now);

test('link z e-maila nie wysyła tokenu w URL i usuwa go z historii po otwarciu', async ({ page }) => {
  const t = token();
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('/pl');
  await page.goto(`/pl/wypisz#t=${encodeURIComponent(t)}`);
  await expect(page.getByRole('button', { name: copy('pl').confirmButton, exact: true })).toBeEnabled();
  expect(new URL(page.url()).pathname).toBe('/pl/wypisz');
  expect(new URL(page.url()).search).toBe('');
  expect(new URL(page.url()).hash).toBe('');
  expect(requests.some((url) => url.includes(t))).toBe(false);
  await page.goBack();
  await page.goForward();
  expect(page.url()).not.toContain(t);
});

test('stary link z query działa, a token znika z widocznego adresu', async ({ page }) => {
  const t = token();
  await page.goto(`/pl/wypisz?t=${encodeURIComponent(t)}`);
  await expect(page.getByRole('button', { name: copy('pl').confirmButton, exact: true })).toBeEnabled();
  expect(new URL(page.url()).searchParams.has('t')).toBe(false);
});

for (const locale of LOCALES) {
  test(`/${locale}/wypisz: potwierdzenie w języku strony, noindex, bez zapisu przy GET`, async ({ page }) => {
    const t = copy(locale);
    const response = await page.goto(`/${locale}/wypisz#t=${encodeURIComponent(token())}`);
    expect(response?.status()).toBe(200);
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.title);
    await expect(page.getByText(t.confirmText.replace('{category}', t.category.offers!))).toBeVisible();
    await expect(page.getByRole('button', { name: t.confirmButton, exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: t.allButton, exact: true })).toBeEnabled();
  });
}

test('„ze wszystkich” w trybie demo: ten sam jawny komunikat, bez udawanego sukcesu', async ({ page }) => {
  const t = copy('nl');
  await page.goto(`/nl/wypisz#t=${encodeURIComponent(token())}`);
  await clickCookieBanner(page, 'nl', 'rejectOptional');
  await page.getByRole('button', { name: t.allButton, exact: true }).click();
  const alert = page.getByRole('alert').filter({ hasText: t.unavailableText });
  await expect(alert).toBeVisible();
  await expect(alert).toBeFocused();
});

test('wysłanie formularza w trybie demo: jawny komunikat, bez udawanego sukcesu', async ({ page }) => {
  const t = copy('fr');
  await page.goto(`/fr/wypisz#t=${encodeURIComponent(token('marketing'))}`);
  await clickCookieBanner(page, 'fr', 'rejectOptional');
  await page.getByRole('button', { name: t.confirmButton, exact: true }).click();
  const alert = page.getByRole('alert').filter({ hasText: t.unavailableText });
  await expect(alert).toBeVisible();
  await expect(alert).toBeFocused();
});

test('zmanipulowany token → „link nieprawidłowy", bez przycisku', async ({ page }) => {
  const t = copy('nl');
  const [v, data, sig] = token().split('.');
  const forgedData = Buffer.from(
    Buffer.from(data!, 'base64url').toString('utf8').replace('|offers|', '|marketing|'),
  ).toString('base64url');
  await page.goto(`/nl/wypisz#t=${v}.${forgedData}.${sig}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.invalidTitle);
  await expect(page.getByRole('button', { name: t.confirmButton, exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: t.allButton, exact: true })).toHaveCount(0);
});

test('wygasły token → „link wygasł", bez przycisku; pusty → nieprawidłowy', async ({ page }) => {
  const t = copy('en');
  const expired = token('offers', Date.now() - (UNSUBSCRIBE_TOKEN_TTL_SECONDS + 60) * 1000);
  await page.goto(`/en/wypisz#t=${encodeURIComponent(expired)}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.expiredTitle);
  await expect(page.getByRole('button', { name: t.confirmButton, exact: true })).toHaveCount(0);
  await page.goto('/en/wypisz');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.invalidTitle);
});

test('strona wypisania bez naruszeń WCAG A/AA (critical/serious)', async ({ page }) => {
  await page.goto(`/pl/wypisz#t=${encodeURIComponent(token())}`);
  await clickCookieBanner(page, 'pl', 'rejectOptional');
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const blocking = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
  expect(blocking.map((v) => v.id)).toEqual([]);
});

test('one-click: GET tylko przekierowuje (303), POST bez bazy → 503, zły token → 400', async ({ request }) => {
  const t = token();
  const get = await request.get(`/api/email/unsubscribe?t=${encodeURIComponent(t)}&l=nl`, { maxRedirects: 0 });
  expect(get.status()).toBe(303);
  const redirect = new URL(get.headers()['location']!);
  expect(redirect.pathname).toBe('/nl/wypisz');
  expect(redirect.search).toBe('');
  expect(redirect.hash).toBe(`#t=${encodeURIComponent(t)}`);

  const form = { headers: { 'content-type': 'application/x-www-form-urlencoded' }, data: 'List-Unsubscribe=One-Click' };
  const post = await request.post(`/api/email/unsubscribe?t=${encodeURIComponent(t)}`, form);
  expect(post.status()).toBe(503);
  const bad = await request.post(`/api/email/unsubscribe?t=${encodeURIComponent(`${t}x`)}`, form);
  expect(bad.status()).toBe(400);
});

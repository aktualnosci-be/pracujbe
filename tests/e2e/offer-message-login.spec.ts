import { expect, test } from '@playwright/test';

/**
 * Link „Wyślij wiadomość” na ofercie prowadzi do logowania z bezpiecznym powrotem (`?next=`).
 * Uruchamiany na serwerze fixture (`playwright.applications-fixture.config.ts`, tryb full):
 * od #297 oferta demo nie ma tego linku (fikcyjnej firmie nie da się napisać).
 */

/** Oferta fikcyjna, na serwerze fixture bez flagi demo (tests/e2e/job-detail-passport.spec.ts). */
const demoOffer = '/pl/oferty-pracy/warehouse-worker-antwerp-1001';

test('„Wyślij wiadomość” na ofercie prowadzi do logowania z powrotem na ofertę', async ({ page }) => {
  await page.goto(demoOffer);
  const link = page.getByRole('link', { name: 'Wyślij wiadomość' });
  await expect(link).toHaveCount(1);
  const href = await link.getAttribute('href');
  const url = new URL(href ?? '', 'http://x');
  expect(url.pathname).toBe('/pl/logowanie');
  expect(url.searchParams.get('next')).toBe(demoOffer);

  // Po przejściu next trafia dalej do linku rejestracji (pełny łańcuch powrotu).
  await link.click();
  await expect(page).toHaveURL(/\/pl\/logowanie\?next=/);
  const registerHref = await page.locator('main a[href^="/pl/rejestracja?"]').getAttribute('href');
  expect(new URL(registerHref ?? '', 'http://x').searchParams.get('next')).toBe(demoOffer);
});

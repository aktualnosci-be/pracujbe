import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * #61 na serwerze fixture (`playwright.applications-fixture.config.ts`, tryb `full`): formularz
 * kontaktu bez konta. Scenariusz: link z Pomocy → pusty formularz (błędy przy polach, fokus na
 * pierwszym) → numer rejestru narodowego w treści (błąd przy polu, bez wysyłki) → przerwane
 * połączenie (dane zostają, ponowienie z tym samym kluczem idempotencji) → sukces z numerem.
 */

const FIXTURE_REFERENCE = 'KON-0000-0E2E';
// Poprawny belgijski numer rejestru narodowego (suma mod 97) — tylko do testu odrzucenia.
const NISS = '85.07.30-033.28';

const pl = JSON.parse(readFileSync(resolve(process.cwd(), 'src', 'messages', 'pl.json'), 'utf-8')) as {
  help: { contactCta: string };
  contact: Record<string, string> & { error: Record<string, string> };
};
const t = pl.contact;

async function blockingViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  return results.violations
    .filter((v) => v.impact === 'critical' || v.impact === 'serious')
    .map((v) => `[${v.impact}] ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
}

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([
    {
      name: 'pracujbe_consent',
      value: JSON.stringify({
        v: process.env.NEXT_PUBLIC_CONSENT_POLICY_VERSION ?? '2.0',
        categories: { necessary: true, preferences: false, analytics: false },
        ts: '2026-01-01T00:00:00.000Z',
        id: 'contact-form-e2e',
      }),
      url: baseURL!,
      sameSite: 'Lax',
    },
  ]);
});

test('gość wysyła wiadomość: walidacja, numer dokumentu, awaria sieci, sukces', async ({ page }) => {
  await page.goto('/pl/pomoc');
  await page.getByRole('link', { name: pl.help.contactCta }).click();
  await expect(page).toHaveURL(/\/pl\/kontakt$/);

  const submit = page.getByRole('button', { name: t.submit });
  await submit.click();
  await expect(page.getByText(t.error.topicRequired)).toBeVisible();
  await expect(page.getByText(t.error.messageRequired)).toBeVisible();
  await expect(page.getByText(t.error.emailRequired)).toBeVisible();
  await expect(page.getByRole('combobox', { name: t.topicLabel })).toBeFocused();
  await expect(page.getByRole('textbox', { name: t.emailLabel })).toHaveAttribute('aria-invalid', 'true');
  expect(await blockingViolations(page)).toEqual([]);

  await page.getByRole('combobox', { name: t.topicLabel }).selectOption({ label: t.topicTechnical });
  const message = page.getByRole('textbox', { name: t.messageLabel });
  await message.fill(`Nie mogę zapisać profilu, mój numer to ${NISS}.`);
  await page.getByRole('textbox', { name: t.emailLabel }).fill('gosc@example.com');

  // Numer rejestru narodowego: błąd przy polu, bez żądania do serwera.
  const bodies: string[] = [];
  let abort = true;
  await page.route('**/*', async (route) => {
    const request = route.request();
    const body = request.postData() ?? '';
    if (!request.headers()['next-action'] || !body.includes('"senderEmail"')) return route.continue();
    bodies.push(body);
    if (abort) return route.abort('connectionreset');
    return route.continue();
  });
  await submit.click();
  await expect(page.getByText(t.error.sensitiveId)).toBeVisible();
  await expect(message).toHaveAttribute('aria-invalid', 'true');
  expect(bodies).toHaveLength(0);

  // Przerwane połączenie: komunikat, aktywny przycisk, dane zostają.
  const text = 'Nie mogę zapisać kroku piątego w kreatorze profilu kandydata.';
  await message.fill(text);
  await submit.click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText(t.networkError);
  await expect(submit).toBeEnabled();
  await expect(message).toHaveValue(text);

  abort = false;
  await submit.click();
  await expect(page.getByRole('heading', { name: t.successTitle })).toBeFocused();
  await expect(page.getByTestId('contact-reference')).toHaveText(FIXTURE_REFERENCE);
  expect(await blockingViolations(page)).toEqual([]);

  expect(bodies).toHaveLength(2);
  const field = (body: string, name: string) => new RegExp(`"${name}":"([^"]+)"`).exec(body)?.[1];
  expect(field(bodies[0]!, 'idempotencyKey')).toBeTruthy();
  expect(field(bodies[1]!, 'idempotencyKey')).toBe(field(bodies[0]!, 'idempotencyKey'));
  expect(field(bodies[1]!, 'locale')).toBe('pl');
});

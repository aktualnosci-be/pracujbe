import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * #41 na serwerze fixture (`playwright.applications-fixture.config.ts`, tryb `full`): oferty
 * fikcyjne bez flagi demo, więc formularz zgłoszenia jest dostępny. Scenariusz gościa:
 * link „Zgłoś firmę” ze szczegółu oferty → błędy przy polach i fokus na pierwszym →
 * przerwane połączenie (dane zostają, ten sam klucz idempotencji przy ponowieniu) →
 * sukces z numerem sprawy i kodem → status sprawy z linku (fragment `#` usunięty z adresu).
 */

const JOB_PATH = '/pl/oferty-pracy/bricklayer-brussels-1002';
const FIXTURE_CASE = 'DSA-0000-0000-0000-0E2E';

const pl = JSON.parse(readFileSync(resolve(process.cwd(), 'src', 'messages', 'pl.json'), 'utf-8')) as {
  contentReport: Record<string, string> & { error: Record<string, string> };
};
const t = pl.contentReport;

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
        v: process.env.NEXT_PUBLIC_CONSENT_POLICY_VERSION ?? '1.0',
        categories: { necessary: true, preferences: false, analytics: false, marketing: false },
        ts: '2026-01-01T00:00:00.000Z',
        id: 'content-report-e2e',
      }),
      url: baseURL!,
      sameSite: 'Lax',
    },
  ]);
});

test('gość zgłasza firmę: walidacja, awaria sieci, sukces, status sprawy', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto(JOB_PATH);
  await page.getByRole('link', { name: t.reportCompany }).click();
  await expect(page).toHaveURL(/\/pl\/zglos-tresc\?oferta=bricklayer-brussels-1002&cel=firma$/);
  const companyOption = page.getByRole('radio', { name: new RegExp(t.targetCompanyOption.split('{')[0]!.trim()) });
  await expect(companyOption).toBeChecked();
  expect(await blockingViolations(page)).toEqual([]);

  // Pusty formularz: błędy przy polach, fokus na pierwszym błędnym polu (kategoria).
  await page.getByRole('button', { name: t.submit }).click();
  await expect(page.getByText(t.error.categoryRequired)).toBeVisible();
  await expect(page.getByText(t.error.detailsRequired)).toBeVisible();
  await expect(page.getByText(t.error.emailRequired)).toBeVisible();
  await expect(page.getByText(t.error.goodFaithRequired)).toBeVisible();
  await expect(page.getByRole('radio', { name: t.categoryFraud })).toBeFocused();
  await expect(page.getByRole('textbox', { name: t.reporterEmailLabel })).toHaveAttribute('aria-invalid', 'true');
  expect(await blockingViolations(page)).toEqual([]);

  await page.getByRole('radio', { name: t.categoryImpersonation }).check();
  const details = page.getByRole('textbox', { name: t.detailsLabel });
  await details.fill('Firma podaje dane innego, znanego pracodawcy i prosi o przelew.');
  await page.getByRole('textbox', { name: t.reporterEmailLabel }).fill('gosc@example.com');
  await page.getByRole('checkbox', { name: t.goodFaithLabel }).check();

  // Przerwane połączenie: komunikat, aktywny przycisk, dane zostają.
  const bodies: string[] = [];
  let abort = true;
  await page.route('**/*', async (route) => {
    const request = route.request();
    const body = request.postData() ?? '';
    if (!request.headers()['next-action'] || !body.includes('"accessCode"')) return route.continue();
    bodies.push(body);
    if (abort) return route.abort('connectionreset');
    return route.continue();
  });
  const submit = page.getByRole('button', { name: t.submit });
  await submit.click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText(t.networkError);
  await expect(submit).toBeEnabled();
  await expect(details).toHaveValue('Firma podaje dane innego, znanego pracodawcy i prosi o przelew.');

  abort = false;
  await submit.click();
  await expect(page.getByRole('heading', { name: t.successTitle })).toBeFocused();
  await expect(page.getByTestId('report-case-number')).toHaveText(FIXTURE_CASE);
  await expect(page.getByTestId('report-access-code')).toHaveText(/^([A-Z2-7]{4}-){5}[A-Z2-7]{4}$/);

  expect(bodies).toHaveLength(2);
  const field = (body: string, name: string) => new RegExp(`"${name}":"([^"]+)"`).exec(body)?.[1];
  expect(field(bodies[0]!, 'idempotencyKey')).toBeTruthy();
  expect(field(bodies[1]!, 'idempotencyKey')).toBe(field(bodies[0]!, 'idempotencyKey'));
  expect(field(bodies[1]!, 'accessCode')).toBe(field(bodies[0]!, 'accessCode'));
  expect(field(bodies[1]!, 'target')).toBe('company');

  // Status z linku: fragment wypełnia pola, jest usuwany z adresu, wynik bez danych osobowych.
  await page.getByRole('link', { name: t.checkCaseLink }).click();
  await expect(page.getByTestId('report-case-status')).toHaveText(t.statusReviewing);
  await expect(page).toHaveURL(/\/pl\/zglos-tresc\/sprawa$/);
  await expect(page.getByRole('heading', { name: t.resultTitle.replace('{caseNumber}', FIXTURE_CASE) })).toBeFocused();
  await expect(page.getByText('gosc@example.com')).toHaveCount(0);
  expect(await blockingViolations(page)).toEqual([]);

  // Kontrola ujemna: inny numer sprawy → brak wyniku.
  await page.getByRole('textbox', { name: t.caseNumberLabel }).fill('DSA-0000-0000-0000-0001');
  await page.getByRole('button', { name: t.lookupSubmit }).click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText(t.lookupNotFound);
  await expect(page.getByTestId('report-case-status')).toHaveCount(0);

  expect(pageErrors.filter((m) => m.includes('Failed to fetch'))).toEqual([]);
});

test('zgłaszający odwołuje się od braku działań (#43): walidacja, sukces, bez danych autora', async ({ page }) => {
  const dismissedCase = 'DSA-0000-0000-0000-1E2E';
  await page.goto(`/pl/zglos-tresc/sprawa#nr=${dismissedCase}&kod=ABCDEFGHIJKLMNOPQRSTUVWX`);
  await expect(page.getByTestId('report-case-outcome')).toHaveText(t.outcomeNoAction);
  const form = page.getByTestId('report-case-appeal-form');
  await expect(form.getByRole('heading', { name: t.appealTitle })).toBeVisible();
  await expect(form.getByText(t.appealLegalPlaceholder)).toBeVisible();

  await form.getByRole('button', { name: t.appealAction }).click();
  const grounds = form.getByRole('textbox', { name: t.appealGroundsLabel });
  await expect(grounds).toBeFocused();

  // Puste uzasadnienie: błąd przy polu, fokus na polu, bez wysyłki.
  await form.getByRole('button', { name: t.appealSubmit }).click();
  await expect(grounds).toHaveAttribute('aria-invalid', 'true');
  await expect(form.getByText(t.appealErrorRequired)).toBeVisible();
  await expect(grounds).toBeFocused();
  expect(await blockingViolations(page)).toEqual([]);

  await grounds.fill('Oferta nadal wymaga opłaty od kandydatów przed rozmową.');
  await form.getByRole('button', { name: t.appealSubmit }).click();
  const sent = page.getByRole('status').filter({ hasText: 'APL-0000-0000-0E2E' });
  await expect(sent).toHaveText(t.appealSent.replace('{reference}', 'APL-0000-0000-0E2E'));
  await expect(sent).toBeFocused();
  expect(await blockingViolations(page)).toEqual([]);
});

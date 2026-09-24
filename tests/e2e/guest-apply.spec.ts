import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { expect, test, type Page } from '@playwright/test';

/**
 * #98 — jednorazowa aplikacja bez konta (serwer fixture `playwright.applications-fixture.config.ts`,
 * tryb `full`, bez bazy; cookie `pb_e2e_viewer=anonymous` = gość). Sprawdza:
 * - gość widzi formularz (imię, e-mail, zgoda) obok logowania/rejestracji,
 * - pusty formularz: błędy przy polach, fokus na pierwszym, nic nie wychodzi do serwera,
 * - wysłanie: przycisk zablokowany, potem neutralny komunikat „sprawdź skrzynkę” z adresem,
 * - dialog bez naruszeń axe critical/serious (320 i 1280 px),
 * - strony linków z e-maili: noindex, bez Referer, GET niczego nie zmienia (przycisk),
 *   nieprawidłowy token → komunikat; przejęcie bez sesji → logowanie z powrotem (z tokenem).
 * - pytania screeningowe (#101, oferta 1003): wymagane bez odpowiedzi blokują wysyłkę gościa
 *   przy pytaniu, po odpowiedzi zgłoszenie wychodzi.
 * Kontrola ujemna (lokalnie): bez `GuestApplyForm` w ApplyModal test „formularz gościa” pada.
 */

const LOCALES = ['pl', 'nl', 'fr', 'en'] as const;
type Locale = (typeof LOCALES)[number];
const JOB_SLUG = 'bricklayer-brussels-1002';
const SCREENING_JOB_SLUG = 'truck-driver-ghent-1003';
const Q_YES_NO = 'f1010000-0000-4000-8000-000000000001';
const Q_CHOICE = 'f1010000-0000-4000-8000-000000000002';
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const BLOCKING = new Set(['critical', 'serious']);

type Messages = {
  jobs: { applyNow: string };
  apply: { submit: string; consent: string };
  guestApply: {
    fullName: string;
    email: string;
    sentTitle: string;
    confirmTitle: string;
    confirmButton: string;
    invalidTitle: string;
    claimTitle: string;
    claimLogin: string;
    error: { nameRequired: string; emailRequired: string; consentRequired: string };
  };
};

function msgs(locale: Locale): Messages {
  return JSON.parse(readFileSync(resolve(process.cwd(), 'src', 'messages', `${locale}.json`), 'utf-8')) as Messages;
}

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([
    {
      name: 'pracujbe_consent',
      value: JSON.stringify({
        v: process.env.NEXT_PUBLIC_CONSENT_POLICY_VERSION ?? '1.0',
        categories: { necessary: true, preferences: false, analytics: false, marketing: false },
        ts: '2026-01-01T00:00:00.000Z',
        id: 'guest-apply-e2e',
      }),
      url: baseURL!,
      sameSite: 'Lax',
    },
    { name: 'pb_e2e_viewer', value: 'anonymous', url: baseURL!, sameSite: 'Lax' },
  ]);
});

async function openGuestForm(page: Page, locale: Locale, width: number, slug = JOB_SLUG) {
  const t = msgs(locale);
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`/${locale}/oferty-pracy/${slug}`);
  // Na danej szerokości widoczny jest dokładnie jeden przycisk (pasek mobilny albo panel boczny).
  await page.getByRole('button', { name: t.jobs.applyNow }).click();
  const dialog = page.getByRole('dialog');
  const form = dialog.getByTestId('guest-apply-form');
  await expect(form).toBeVisible();
  return { t, dialog, form };
}

for (const locale of LOCALES) {
  test(`formularz gościa: błędy przy polach, wysłanie, neutralny sukces (${locale})`, async ({ page }) => {
    const { t, dialog, form } = await openGuestForm(page, locale, 1280);
    await expect(dialog.getByTestId('apply-guest')).toBeVisible();

    const name = form.getByRole('textbox', { name: t.guestApply.fullName });
    const email = form.getByRole('textbox', { name: t.guestApply.email });
    const submit = form.getByRole('button', { name: t.apply.submit });

    const actions: string[] = [];
    page.on('request', (request) => {
      if (request.headers()['next-action'] && (request.postData() ?? '').includes('"fullName"')) actions.push(request.url());
    });

    await submit.click();
    await expect(name).toHaveAttribute('aria-invalid', 'true');
    await expect(name).toBeFocused();
    await expect(name).toHaveAccessibleDescription(t.guestApply.error.nameRequired);
    await expect(email).toHaveAccessibleDescription(t.guestApply.error.emailRequired);
    await expect(form.getByRole('checkbox', { name: t.apply.consent })).toHaveAccessibleDescription(
      t.guestApply.error.consentRequired,
    );
    expect(actions).toHaveLength(0);

    await name.fill('Anna Nowak');
    await email.fill('anna@example.com');
    await form.getByRole('checkbox', { name: t.apply.consent }).click();
    await submit.click();

    const sent = dialog.getByTestId('guest-apply-sent');
    await expect(sent).toBeVisible();
    await expect(sent.getByRole('heading', { name: t.guestApply.sentTitle })).toBeFocused();
    await expect(sent).toContainText('anna@example.com');
    expect(actions).toHaveLength(1);
  });
}

test('pytania screeningowe (#101): gość musi odpowiedzieć na wymagane, potem zgłoszenie wychodzi', async ({ page }) => {
  const { t, dialog, form } = await openGuestForm(page, 'pl', 1280, SCREENING_JOB_SLUG);
  await form.getByRole('textbox', { name: t.guestApply.fullName }).fill('Anna Nowak');
  await form.getByRole('textbox', { name: t.guestApply.email }).fill('anna@example.com');
  await form.getByRole('checkbox', { name: t.apply.consent }).click();
  await form.getByRole('button', { name: t.apply.submit }).click();

  await expect(page.locator(`#apply-q-${Q_YES_NO}`)).toBeFocused();
  await expect(dialog.getByTestId('guest-apply-sent')).toHaveCount(0);

  await page.locator(`#apply-q-${Q_YES_NO}`).check();
  await page.locator(`#apply-q-${Q_CHOICE}`).check();
  await form.getByRole('button', { name: t.apply.submit }).click();
  await expect(dialog.getByTestId('guest-apply-sent')).toBeVisible();
});

for (const width of [320, 1280]) {
  test(`dialog gościa bez naruszeń axe critical/serious (${width}px)`, async ({ page }) => {
    const { dialog } = await openGuestForm(page, 'pl', width);
    await expect(dialog).toBeVisible();
    const results = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(WCAG_TAGS).analyze();
    const blocking = results.violations
      .filter((v) => BLOCKING.has(v.impact ?? ''))
      .map((v) => `- [${v.impact}] ${v.id} (${v.nodes.length}×): ${v.nodes[0]?.target.join(' ')}`);
    expect(blocking, blocking.join('\n')).toEqual([]);
  });
}

test('link potwierdzenia: noindex, bez Referer, GET nic nie potwierdza, zły token → komunikat', async ({ page }) => {
  const t = msgs('pl');
  const token = 'x'.repeat(10);
  const response = await page.goto(`/pl/aplikacja/potwierdz?token=${token}`);
  expect(response?.status()).toBe(200);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer');
  await expect(page.getByRole('heading', { level: 1, name: t.guestApply.confirmTitle })).toBeVisible();
  await expect(page.getByRole('heading', { name: t.guestApply.invalidTitle })).toHaveCount(0);

  await page.getByRole('button', { name: t.guestApply.confirmButton }).click();
  await expect(page.getByRole('heading', { name: t.guestApply.invalidTitle })).toBeFocused();
});

test('link przejęcia bez sesji: logowanie wraca na tę stronę z tokenem', async ({ page }) => {
  const t = msgs('en');
  const token = 'A'.repeat(43);
  await page.goto(`/en/aplikacja/przejmij?token=${token}`);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  await expect(page.getByRole('heading', { level: 1, name: t.guestApply.claimTitle })).toBeVisible();
  const login = page.getByRole('link', { name: t.guestApply.claimLogin });
  const href = new URL((await login.getAttribute('href')) ?? '', 'http://localhost');
  expect(href.pathname).toBe('/en/logowanie');
  expect(href.searchParams.get('next')).toBe(`/en/aplikacja/przejmij?token=${token}`);
});

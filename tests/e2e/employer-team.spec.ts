import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import AxeBuilder from './fixtures/axe';
import { expect, test, type Page } from '@playwright/test';

/**
 * Zespół firmy i kolejna firma (#403) — panel pracodawcy w trybie demo (bez bazy).
 * Kontrolki po roli i nazwie z `src/messages`. Realny zapis i hierarchię ról dowodzi
 * `supabase/tests/rls.sql` (sekcja TM403); tu: nawigacja, formularze, stany i a11y.
 */

type TeamCopy = Record<string, string> & { error: Record<string, string>; signup: Record<string, string> };
type Messages = {
  team: TeamCopy;
  dashboard: Record<string, string>;
  company: Record<string, string> & { error: Record<string, string> };
  auth: Record<string, string>;
};

const LOCALES = ['pl', 'nl', 'fr', 'en'] as const;
const messages = Object.fromEntries(
  LOCALES.map((l) => [l, JSON.parse(readFileSync(resolve(process.cwd(), 'src', 'messages', `${l}.json`), 'utf8'))]),
) as Record<(typeof LOCALES)[number], Messages>;

async function storeConsent(page: Page) {
  await page.context().addCookies([
    {
      name: 'pracujbe_consent',
      value: JSON.stringify({
        v: process.env.NEXT_PUBLIC_CONSENT_POLICY_VERSION ?? '2.0',
        categories: { necessary: true, preferences: false, analytics: false },
        ts: '2026-01-01T00:00:00.000Z',
        id: 'employer-team-e2e',
      }),
      url: 'http://localhost:3000',
      sameSite: 'Lax',
    },
  ]);
}

test.beforeEach(async ({ page }) => storeConsent(page));

test('nawigacja „Zespół” prowadzi do listy członków z opisem ról (#403)', async ({ page }) => {
  const t = messages.pl.team;
  await page.goto('/pl/employer');
  await page.getByRole('link', { name: messages.pl.dashboard.navTeam }).first().click();
  await expect(page).toHaveURL(/\/pl\/employer\/zespol$/);
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1, name: t.title })).toBeVisible();
  await expect(main.getByText(t.demoNotice).first()).toBeVisible();
  const members = main.getByRole('list', { name: t.membersTitle });
  await expect(members.getByRole('listitem')).toHaveCount(3);
  // Własne konto: bez kontrolek, z wyjaśnieniem.
  await expect(members.getByText(t.selfNote)).toBeVisible();
  // Nieaktywna osoba: „Przywróć dostęp”.
  await expect(
    members.getByRole('button', { name: t.reactivateLabel.replace('{name}', 'Sofie Maes') }),
  ).toBeVisible();
  await expect(main.getByRole('heading', { name: t.rolesTitle })).toBeVisible();
});

test('zaproszenie: puste i błędne pole daje błąd przy polu, poprawne — komunikat (#403)', async ({ page }) => {
  const t = messages.pl.team;
  await page.goto('/pl/employer/zespol');
  const main = page.getByRole('main');
  const email = main.getByLabel(t.emailLabel, { exact: true });
  const submit = main.getByRole('button', { name: t.inviteSubmit });

  await submit.click();
  await expect(main.getByText(t.error.emailRequired, { exact: true })).toBeVisible();
  await expect(email).toHaveAttribute('aria-invalid', 'true');
  await expect(email).toBeFocused();

  await email.fill('bez-malpy');
  await submit.click();
  await expect(main.getByText(t.error.emailInvalid, { exact: true })).toBeVisible();

  await email.fill('rita@firma.be');
  await main.getByRole('combobox', { name: t.roleLabel, exact: true }).selectOption('member');
  await submit.click();
  await expect(main.getByRole('status').filter({ hasText: t.demoNotice })).toBeVisible();
  // Kontrola ujemna: roli właściciela nie da się wybrać w zaproszeniu.
  await expect(main.getByRole('combobox', { name: t.roleLabel, exact: true }).locator('option[value="owner"]')).toHaveCount(0);
});

test('odebranie dostępu wymaga potwierdzenia, anulowanie nic nie zmienia (#403)', async ({ page }) => {
  const t = messages.pl.team;
  await page.goto('/pl/employer/zespol');
  const main = page.getByRole('main');
  await main.getByRole('button', { name: t.deactivateLabel.replace('{name}', 'Tom Janssens') }).click();
  const dialog = page.getByRole('alertdialog', { name: t.deactivateTitle.replace('{name}', 'Tom Janssens') });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Anuluj' }).click();
  await expect(dialog).toHaveCount(0);
});

for (const locale of LOCALES) {
  test(`oczekujące zaproszenie: język, autor, „Odnów” i „Cofnij” z potwierdzeniem (0235, ${locale})`, async ({ page }) => {
    const t = messages[locale].team;
    const email = 'nowa.osoba@example.be';
    await page.goto(`/${locale}/employer/zespol`);
    const main = page.getByRole('main');
    const row = main.getByRole('listitem').filter({ hasText: email });
    // Dane demo: zaproszenie w języku nl, wysłane przez Annę Peeters.
    await expect(row.getByText(t.invitationLanguage.replace('{language}', 'Nederlands'), { exact: false })).toBeVisible();
    await expect(row.getByText('Anna Peeters', { exact: false })).toBeVisible();

    await row.getByRole('button', { name: t.renewLabel.replace('{email}', email) }).click();
    const status = main.getByRole('status').filter({ hasText: t.demoNotice });
    await expect(status).toBeVisible();
    await expect(status).toBeFocused();

    // Kontrola ujemna: „Cofnij” otwiera dialog, anulowanie zostawia zaproszenie.
    await row.getByRole('button', { name: t.revokeLabel.replace('{email}', email) }).click();
    const dialog = page.getByRole('alertdialog', { name: t.revokeTitle.replace('{email}', email) });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(t.revokeDesc);
    const cancel = (messages[locale] as unknown as { common: { cancel: string } }).common.cancel;
    await expect(dialog.getByRole('button', { name: t.revokeConfirm, exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: cancel, exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(row).toBeVisible();
  });
}

test('„Dodaj kolejną firmę” z przełącznika otwiera formularz nowej firmy (#403)', async ({ page }) => {
  const t = messages.pl.team;
  await page.goto('/pl/employer');
  await page.getByRole('link', { name: t.addCompany }).first().click();
  await expect(page).toHaveURL(/\/pl\/employer\/firma\/nowa$/);
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1, name: t.addCompanyTitle })).toBeVisible();
  await main.getByRole('button', { name: messages.pl.company.submitCreate }).click();
  await expect(main.getByText(messages.pl.company.error.nameRequired!)).toBeVisible();
  await main.getByLabel(messages.pl.company.name).fill('Druga Firma Demo');
  await main.getByRole('button', { name: messages.pl.company.submitCreate }).click();
  await expect(main.getByRole('status').filter({ hasText: t.demoNotice })).toBeVisible();
});

for (const locale of LOCALES) {
  test(`język zaproszenia domyślnie = język strony, tylko PL/NL/FR/EN (0121, ${locale})`, async ({ page }) => {
    const t = messages[locale].team;
    await page.goto(`/${locale}/employer/zespol`);
    const main = page.getByRole('main');
    const select = main.getByRole('combobox', { name: t.localeLabel, exact: true });
    await expect(select).toHaveValue(locale);
    await expect(select.locator('option')).toHaveCount(4);
    await expect(select).toHaveAccessibleDescription(t.inviteLinkHint);
  });
}

test('link rejestracji z nieważnym tokenem: token znika z adresu, komunikat, zwykła rejestracja (0121)', async ({ page }) => {
  const t = messages.pl.team;
  await page.goto('/pl/rejestracja-pracodawca#token=' + 'x'.repeat(43));
  const main = page.getByRole('main');
  await expect(main.getByRole('alert').filter({ hasText: t.signup.invalid })).toBeVisible();
  await expect(page).toHaveURL(/\/pl\/rejestracja-pracodawca$/);
  await expect(main.getByLabel(messages.pl.auth.companyName!, { exact: true })).toBeVisible();
});

for (const locale of LOCALES) {
  test(`strona zespołu bez naruszeń a11y i z tekstami w języku strony (${locale}, 320 px)`, async ({ page }) => {
    const t = messages[locale].team;
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`/${locale}/employer/zespol`);
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 1, name: t.title })).toBeVisible();
    await expect(main.getByRole('button', { name: t.inviteSubmit })).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    const blocking = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
    expect(blocking.map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);
    const scroll = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(scroll).toBeLessThanOrEqual(0);
  });
}

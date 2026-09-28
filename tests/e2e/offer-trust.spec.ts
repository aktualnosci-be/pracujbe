import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import AxeBuilder from './fixtures/axe';
import { expect, test, type Page } from '@playwright/test';

import { LOCALES, rejectOptionalCookies } from './fixtures/messages';

/**
 * Zaufanie ofert (0167) w trybie DEMO (bez bazy): kolejka przeglądu treści ofert z sygnałem
 * (źródło reguła/AI, odrzucenie wymaga uzasadnienia), formularz deklaracji agencji w panelu
 * pracodawcy (numer wymagany, fokus, błąd przy polu) i filtr „bezpośrednio od pracodawcy”
 * na liście ofert. Egzekwowanie (blokada publikacji, wstrzymanie, CAS numeru, filtr w SQL)
 * dowodzi `supabase/tests/rls.sql` sekcja FT167. Kontrolki po roli i nazwie z `src/messages`.
 */

type Messages = {
  admin: Record<string, string>;
  company: Record<string, string>;
  filters: Record<string, string>;
  jobTrust: Record<string, string>;
};

function messages(locale: string): Messages {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), 'src', 'messages', `${locale}.json`), 'utf-8'),
  ) as Messages;
}

async function blockingViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  return results.violations
    .filter((v) => v.impact === 'critical' || v.impact === 'serious')
    .map((v) => `[${v.impact}] ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
}

for (const locale of LOCALES) {
  test(`admin treść ofert (${locale}): źródło sygnału i odrzucenie z uzasadnieniem`, async ({ page }) => {
    const m = messages(locale);
    await page.goto(`/${locale}/admin/tresc-ofert`);
    await rejectOptionalCookies(page, locale);

    await expect(page.getByRole('heading', { level: 1, name: m.admin.jobContentTitle })).toBeVisible();
    const rulesRow = page.getByTestId('job-content-review').filter({ hasText: 'Magazynier / Magazynierka' });
    await expect(rulesRow).toContainText(m.admin.jobContentSourceRules!);
    await expect(rulesRow).toContainText(m.jobTrust.categoryCandidateFee!);
    const aiRow = page.getByTestId('job-content-review').filter({ hasText: 'Pakowanie produktów w domu' });
    await expect(aiRow).toContainText(m.admin.jobContentSourceAi!);
    await expect(aiRow).toContainText(m.jobTrust.categoryUnrealisticOffer!);
    expect(await blockingViolations(page)).toEqual([]);

    await rulesRow.getByRole('button', { name: m.admin.jobContentActionReject }).click();
    const dialog = page.getByRole('alertdialog', { name: m.admin.jobContentRejectConfirmTitle });
    const reason = dialog.getByRole('textbox', { name: m.admin.reasonLabel });
    await expect(reason).toBeFocused();
    await dialog.getByRole('button', { name: m.admin.jobContentActionReject }).click();
    await expect(dialog.getByText(m.admin.reasonRequired!)).toBeVisible();
    await expect(reason).toHaveAttribute('aria-invalid', 'true');
    await reason.fill('Opłata od kandydata.');
    await dialog.getByRole('button', { name: m.admin.jobContentActionReject }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: m.admin.jobContentRejected })).toBeVisible();
  });
}

test('panel pracodawcy: deklaracja agencji wymaga numeru uznania (demo)', async ({ page }) => {
  const m = messages('pl');
  await page.goto('/pl/employer/firma');
  await rejectOptionalCookies(page, 'pl');
  const form = page.getByTestId('company-agency-form');
  await expect(page.getByRole('heading', { name: m.company.agencyTitle, exact: true })).toBeVisible();

  await form.getByRole('checkbox', { name: m.company.agencyLabel }).check();
  const number = form.getByRole('textbox', { name: m.company.agencyNumberLabel });
  await form.getByRole('button', { name: m.company.agencySubmit }).click();
  await expect(form.getByText(m.company.agencyNumberRequired!)).toBeVisible();
  await expect(number).toBeFocused();
  await expect(number).toHaveAttribute('aria-invalid', 'true');

  await number.fill('VG.1234/BU');
  await form.getByRole('button', { name: m.company.agencySubmit }).click();
  await expect(form.getByRole('status')).toContainText(m.company.agencyDemoNotice!);
  expect(await blockingViolations(page)).toEqual([]);
});

test('lista ofert: filtr „bezpośrednio od pracodawcy” trafia do adresu', async ({ page }) => {
  const m = messages('pl');
  await page.goto('/pl/oferty-pracy?direct=1');
  await rejectOptionalCookies(page, 'pl');
  // Sidebar (desktop) i arkusz filtrów (mobile) — każda widoczna kontrolka odzwierciedla adres.
  const boxes = page.getByRole('checkbox', { name: new RegExp(m.filters.directOnly!) });
  await expect(boxes).not.toHaveCount(0);
  for (const box of await boxes.all()) {
    if (await box.isVisible()) await expect(box).toBeChecked();
  }
});

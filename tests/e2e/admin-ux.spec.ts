import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { LOCALES, rejectOptionalCookies } from './fixtures/messages';

/**
 * Panel administratora w trybie DEMO: fokus po potwierdzeniu (#415), zgłoszenia — cel, powód
 * jako etykieta, filtr statusu, potwierdzenie rozstrzygnięcia (#416, #422), wyszukiwanie list
 * (#418), brak martwego dzwonka (#423), dziennik zdarzeń (#417). Kontrolki po roli i nazwie
 * z `src/messages` (#376).
 */

type AdminMessages = Record<string, string>;

function admin(locale: string): AdminMessages {
  const all = JSON.parse(
    readFileSync(resolve(process.cwd(), 'src', 'messages', `${locale}.json`), 'utf-8'),
  ) as { admin: AdminMessages };
  return all.admin;
}

function bellName(locale: string): RegExp {
  const all = JSON.parse(
    readFileSync(resolve(process.cwd(), 'src', 'messages', `${locale}.json`), 'utf-8'),
  ) as { notifications: { bellLabel: string; loadError: string } };
  // Pierwsze słowo etykiety dzwonka (ICU z liczbą) — wystarczy do wykrycia przycisku.
  const word = all.notifications.bellLabel.replace(/\{[^}]*\}/g, '').trim().split(/\s+/)[0]!;
  return new RegExp(word, 'i');
}

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function blockingViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return results.violations
    .filter((v) => v.impact === 'critical' || v.impact === 'serious')
    .map((v) => `[${v.impact}] ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
}

async function activeTag(page: Page) {
  return page.evaluate(() => document.activeElement?.tagName ?? 'NONE');
}

for (const locale of LOCALES) {
  const t = admin(locale);

  test(`admin #415: po potwierdzeniu odrzucenia firmy fokus nie spada na body (${locale})`, async ({
    page,
  }) => {
    await page.goto(`/${locale}/admin/firmy?status=awaiting`);
    await rejectOptionalCookies(page, locale);
    const row = page.getByRole('row', { name: /Bouwbedrijf De Vos/ });
    await row.getByRole('button', { name: t.actionRejectCompany, exact: true }).click();

    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    // Odrzucenie wymaga uzasadnienia (#310).
    await dialog.getByRole('textbox', { name: t.reasonLabel }).fill('VAT nie zgadza się z KBO');
    await dialog.getByRole('button', { name: t.actionRejectCompany, exact: true }).press('Enter');
    await expect(dialog).toHaveCount(0);

    await expect(page.getByRole('status').filter({ hasText: t.statusChanged })).toBeVisible();
    await expect.poll(() => activeTag(page)).not.toBe('BODY');
    // Fokus na nagłówku wiersza firmy (tryb demo nie zmienia danych, wiersz zostaje).
    await expect(page.getByRole('rowheader', { name: 'Bouwbedrijf De Vos' })).toBeFocused();
  });

  test(`admin #416/#422: zgłoszenia — cel, etykieta powodu, potwierdzenie i fokus (${locale})`, async ({
    page,
  }) => {
    await page.goto(`/${locale}/admin/zgloszenia`);
    await rejectOptionalCookies(page, locale);
    const main = page.getByRole('main');

    // Powód ze słownika, bez surowych kodów.
    for (const code of ['spam', 'misleading', 'harassment']) {
      await expect(main.getByText(code, { exact: true })).toHaveCount(0);
    }
    await expect(main.getByRole('heading', { name: t.reasonMisleading })).toBeVisible();
    // Cel: link do oferty publicznej i do firmy w panelu, podgląd wiadomości.
    await expect(main.getByRole('link', { name: 'TransEuro Trucking' })).toHaveAttribute(
      'href',
      new RegExp(`/${locale}/admin/firmy\\?q=TransEuro`),
    );
    // Dwie oferty w demo: zwykłe zgłoszenie i sprawa DSA (#41).
    await expect(main.locator('a[href*="/oferty-pracy/"]')).toHaveCount(2);
    await expect(main.getByText('Odpowiedz od razu albo zapomnij o tej pracy.')).toBeVisible();

    // Filtr domyślny „do rozpatrzenia” zaznaczony; filtr „Rozwiązane” nie pokazuje otwartych.
    await expect(main.getByRole('link', { name: t.filterReportsActive, exact: true })).toHaveAttribute(
      'aria-current',
      'true',
    );

    // Rozstrzygnięcie wymaga potwierdzenia z nazwą celu.
    const card = main.getByRole('listitem').filter({ hasText: 'TransEuro Trucking' });
    await card.getByRole('button', { name: t.actionDismissReport, exact: true }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('TransEuro Trucking');
    await expect(dialog.getByRole('button', { name: t.confirmCancel })).toBeFocused();
    expect(await blockingViolations(page)).toEqual([]);
    await dialog.getByRole('button', { name: t.actionDismissReport, exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: t.reportResolved })).toBeVisible();
    await expect.poll(() => activeTag(page)).not.toBe('BODY');
    await expect(main.getByRole('heading', { name: t.reasonMisleading })).toBeFocused();
  });

  test(`admin #423: brak martwego dzwonka powiadomień (${locale})`, async ({ page }) => {
    await page.goto(`/${locale}/admin`);
    await page.getByRole('main').waitFor();
    await expect(page.getByRole('button', { name: bellName(locale) })).toHaveCount(0);
  });
}

test('admin #416: filtr „Rozwiązane” i kafelek otwartych zgłoszeń', async ({ page }) => {
  const t = admin('pl');
  await page.goto('/pl/admin');
  await page.getByRole('link', { name: new RegExp(t.statOpenReports) }).click();
  await expect(page).toHaveURL(/\/pl\/admin\/zgloszenia\?status=open$/);
  await expect(page.getByRole('link', { name: t.statusOpen, exact: true })).toHaveAttribute(
    'aria-current',
    'true',
  );
  // Kontrola ujemna: w „Rozwiązane” nie ma otwartych zgłoszeń z demo.
  await page.goto('/pl/admin/zgloszenia?status=resolved');
  await expect(page.getByRole('main').getByText(t.reportsEmpty)).toBeVisible();
});

test('admin #42: kolejka DSA — domyślnie priorytet i termin, filtr „oflagowane”', async ({ page }) => {
  const t = admin('pl');
  await page.goto('/pl/admin/zgloszenia?kind=dsa_notice');
  await rejectOptionalCookies(page, 'pl');
  const main = page.getByRole('main');
  const sortNav = main.getByRole('navigation', { name: t.reportsSortLabel });
  await expect(sortNav.getByRole('link', { name: t.reportsSortPriority })).toHaveAttribute('aria-current', 'true');
  await sortNav.getByRole('link', { name: t.reportsSortNewest }).click();
  await expect(page).toHaveURL(/\/pl\/admin\/zgloszenia\?kind=dsa_notice&sort=newest$/);
  await expect(sortNav.getByRole('link', { name: t.reportsSortNewest })).toHaveAttribute('aria-current', 'true');

  // Sprawa demo nie jest oflagowana: filtr ją ukrywa, „Wszystkie sprawy” pokazuje (kontrola ujemna).
  const flagNav = main.getByRole('navigation', { name: t.reportsFlaggedLabel });
  await flagNav.getByRole('link', { name: t.reportsFlaggedOnly }).click();
  await expect(page).toHaveURL(/flagged=1/);
  await expect(page).toHaveURL(/sort=newest/);
  await expect(main.getByText(t.reportsEmpty)).toBeVisible();
  await expect(main.getByText('DSA-7F3A-19C2-B4E0-5D11')).toHaveCount(0);
  await flagNav.getByRole('link', { name: t.reportsFlaggedAll }).click();
  await expect(main.getByRole('listitem').filter({ hasText: 'DSA-7F3A-19C2-B4E0-5D11' })).toHaveCount(1);
  // Po nawigacji klienckiej metadane strony dynamicznej (tytuł) są strumieniowane po treści:
  // lista bywa już widoczna, a <title> jeszcze nie — axe łapał wtedy `document-title`.
  // Czekamy na stan końcowy (właściwy tytuł), a nie na stan pośredni.
  await expect(page).toHaveTitle(new RegExp(t.reportsTitle));
  expect(await blockingViolations(page)).toEqual([]);
});

test('admin #42: sprawę DSA rozstrzyga decyzja z uzasadnieniem, nie sama zmiana statusu', async ({
  page,
}) => {
  const t = admin('pl');
  await page.goto('/pl/admin/zgloszenia?kind=dsa_notice');
  await rejectOptionalCookies(page, 'pl');
  const card = page.getByRole('main').getByRole('listitem').filter({ hasText: 'DSA-7F3A-19C2-B4E0-5D11' });
  await expect(card).toHaveCount(1);
  // Kontrola ujemna: brak skrótu „Rozwiąż”/„Oddal” dla sprawy DSA.
  await expect(card.getByRole('button', { name: t.actionResolve, exact: true })).toHaveCount(0);
  await expect(card.getByRole('button', { name: t.actionDismissReport, exact: true })).toHaveCount(0);

  const trigger = card.getByRole('button', { name: t.actionDecide, exact: true });
  await trigger.click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('DSA-7F3A-19C2-B4E0-5D11');

  // Ograniczenie bez faktów i podstawy → błąd przy polu, dialog zostaje otwarty.
  await dialog.getByRole('radio', { name: t.decisionJobRemoved }).check();
  await dialog.getByRole('button', { name: t.decisionConfirm, exact: true }).click();
  const facts = dialog.getByRole('textbox', { name: t.decisionFactsLabel });
  await expect(facts).toBeFocused();
  await expect(facts).toHaveAttribute('aria-invalid', 'true');
  expect(await blockingViolations(page)).toEqual([]);

  await facts.fill('Oferta wymaga od kandydatów opłaty za rekrutację z góry.');
  await dialog.getByRole('radio', { name: t.decisionGroundTerms }).check();
  await dialog.getByRole('textbox', { name: t.decisionGroundReferenceLabel }).fill('§ 4 ust. 2');
  await dialog.getByRole('button', { name: t.decisionConfirm, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: t.decisionSaved })).toBeVisible();
  await expect.poll(() => activeTag(page)).not.toBe('BODY');
});

test('admin #418: wyszukiwanie firm i użytkowników po stronie serwera (parametry w URL)', async ({
  page,
}) => {
  const t = admin('pl');
  await page.goto('/pl/admin/firmy');
  await rejectOptionalCookies(page, 'pl');
  await page.getByRole('searchbox', { name: t.searchCompaniesLabel }).fill('BE0987654321');
  await page.getByRole('button', { name: t.searchSubmit }).click();
  await expect(page).toHaveURL(/\/pl\/admin\/firmy\?q=BE0987654321$/);
  const table = page.getByRole('table');
  await expect(table.getByRole('row', { name: /Bouwbedrijf De Vos/ })).toBeVisible();
  await expect(table.getByRole('row', { name: /AGO Jobs & HR/ })).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'BE0987654321' })).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);

  await page.goto('/pl/admin/uzytkownicy?role=employer');
  await expect(page.getByRole('combobox', { name: t.colRole })).toHaveValue('employer');
  await expect(page.getByRole('table').getByText('Jan Peeters')).toBeVisible();
  await expect(page.getByRole('table').getByText('Adam Kowalski')).toHaveCount(0);
});

test('admin #417: dziennik zdarzeń w nawigacji, etykiety akcji i filtr aktora „system”', async ({
  page,
}) => {
  const t = admin('pl');
  await page.goto('/pl/admin');
  await page.getByRole('link', { name: t.navAudit }).first().click();
  await expect(page).toHaveURL(/\/pl\/admin\/dziennik$/);
  const list = page.getByRole('main').getByRole('list');
  await expect(list.getByText(t.auditActionCompanyStatus)).toBeVisible();
  await expect(page.getByRole('main').getByText('company.status_changed')).toHaveCount(0);

  await page.goto('/pl/admin/dziennik?actor=system');
  await expect(list.getByText(t.auditActionCompanyCreated)).toBeVisible();
  await expect(list.getByText(t.auditActionCompanyStatus)).toHaveCount(0);
});

test('admin #418: listy z wyszukiwaniem i stronicowaniem bez poziomego scrolla przy 320 px i 200% tekstu', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  for (const route of ['/admin/firmy', '/admin/zgloszenia', '/admin/uzytkownicy', '/admin/dziennik']) {
    await page.goto(`/pl${route}`);
    await page.getByRole('main').waitFor();
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, route).toBeLessThanOrEqual(1);
  }
});

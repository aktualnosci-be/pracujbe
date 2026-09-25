import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { LOCALES, rejectOptionalCookies } from './fixtures/messages';

/**
 * Zgłoszenie wiadomości i rozmowy (0116) w trybie DEMO: przycisk tylko przy wiadomości
 * drugiej strony, dialog z powodem ze słownika (błąd przy polu z fokusem, bez wysyłki),
 * opcjonalny opis z limitem, znacznik treści prawnej „do uzupełnienia”, stan „Zgłoszenie
 * przyjęte” z fokusem na komunikacie; axe (critical/serious + target-size) przy otwartym
 * dialogu. Panel admina: filtr rodzaju „Wiadomości” z dowodem zgłoszonej wiadomości.
 * Zapis, dostęp i idempotencja w bazie: rls.sql sekcja MR.
 */

type Copy = Record<string, string>;

function messagesOf(locale: string): { messages: Copy; common: Copy; admin: Copy } {
  return JSON.parse(readFileSync(resolve('src/messages', `${locale}.json`), 'utf8')) as {
    messages: Copy;
    common: Copy;
    admin: Copy;
  };
}

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function audit(page: Page) {
  const results = await new AxeBuilder({ page })
    .options({ rules: { 'target-size': { enabled: true } } })
    .withTags(WCAG_TAGS)
    .analyze();
  return results.violations
    .filter((v) => v.impact === 'critical' || v.impact === 'serious' || v.id === 'target-size')
    .map((v) => `[${v.impact}] ${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
}

for (const locale of LOCALES) {
  test(`zgłoszenie wiadomości — dialog, walidacja, sukces (${locale})`, async ({ page }) => {
    const { messages: m } = messagesOf(locale);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/${locale}/candidate/wiadomosci?c=demo-conv-0`);
    await rejectOptionalCookies(page, locale);

    const name = (await page.locator('#thread-heading').textContent())?.trim() ?? '';
    const thread = page.getByRole('region', { name, exact: true });
    const list = thread.getByRole('list', { name: m.threadListLabel!.replace('{name}', name) });
    const items = list.getByRole('listitem');

    // Przycisk zgłoszenia tylko przy wiadomościach drugiej strony (demo: 2 z 3).
    const prefix = m.reportMessageLabel!.split('{sender}')[0]!.trim();
    const triggers = list.getByRole('button', { name: new RegExp(`^${prefix}`) });
    await expect(triggers).toHaveCount(2);
    // Własne wiadomości: podpis zaczyna się od „Ty · ” (nadawca przed treścią w DOM, #358).
    const mine = items.filter({ hasText: new RegExp(`^${m.you!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} · `) });
    await expect(mine).toHaveCount(1);
    await expect(mine.getByRole('button')).toHaveCount(0);

    // Zgłoszenie całej rozmowy dostępne w nagłówku wątku.
    await expect(
      thread.getByRole('button', { name: m.reportConversationLabel!.replace('{name}', name), exact: true }),
    ).toBeVisible();

    await triggers.first().click();
    const dialog = page.getByRole('dialog', { name: m.reportDialogTitleMessage });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(m.reportLegalPlaceholder!)).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: m.reportDetailsLabel })).toHaveAttribute('maxlength', '1000');

    // Kontrola ujemna: bez powodu — błąd przy polu, fokus na pierwszej opcji, dialog otwarty.
    await dialog.getByRole('button', { name: m.reportSubmit, exact: true }).click();
    await expect(dialog.getByRole('alert')).toHaveText(m.reportCategoryRequired!);
    await expect(dialog.getByRole('radio', { name: m.reportCategorySpam, exact: true })).toBeFocused();
    expect(await audit(page)).toEqual([]);

    await dialog.getByRole('radio', { name: m.reportCategoryHarassment, exact: true }).check();
    await dialog.getByRole('textbox', { name: m.reportDetailsLabel }).fill('Groźby w wiadomości.');
    await dialog.getByRole('button', { name: m.reportSubmit, exact: true }).click();
    await expect(dialog).toHaveCount(0);

    const status = list.getByRole('status');
    await expect(status).toHaveText(m.reportSent!);
    await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');
    await expect(triggers).toHaveCount(1);
  });
}

test('zgłoszenie rozmowy — dialog bez treści wiadomości, axe przy 320 px (pl)', async ({ page }) => {
  const { messages: m } = messagesOf('pl');
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/pl/employer/wiadomosci?c=demo-conv-1');
  await rejectOptionalCookies(page, 'pl');
  const name = (await page.locator('#thread-heading').textContent())?.trim() ?? '';
  await page.getByRole('button', { name: m.reportConversationLabel!.replace('{name}', name), exact: true }).click();
  const dialog = page.getByRole('dialog', { name: m.reportDialogTitleConversation });
  await expect(dialog.getByText(m.reportConversationHint!)).toBeVisible();
  await expect(dialog.getByRole('blockquote')).toHaveCount(0);
  expect(await audit(page)).toEqual([]);
});

test('admin: filtr „Wiadomości” pokazuje dowód zgłoszonej wiadomości (pl)', async ({ page }) => {
  const { admin: t } = messagesOf('pl');
  await page.goto('/pl/admin/zgloszenia');
  await rejectOptionalCookies(page, 'pl');
  await page.getByRole('link', { name: t.kindMessage, exact: true }).click();
  await expect(page).toHaveURL(/\/pl\/admin\/zgloszenia\?kind=message_report$/);
  const main = page.getByRole('main');
  const cards = main.getByRole('listitem');
  await expect(cards).toHaveCount(1);
  await expect(cards.first().getByText(t.messageReportScopeMessage!)).toBeVisible();
  await expect(cards.first().getByText('Odpowiedz od razu albo zapomnij o tej pracy.')).toBeVisible();
  // Kontrola ujemna: sprawy DSA nie ma w tym filtrze.
  await expect(main.getByText('DSA-7F3A-19C2-B4E0-5D11')).toHaveCount(0);
});

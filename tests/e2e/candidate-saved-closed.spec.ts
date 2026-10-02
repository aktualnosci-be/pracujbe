import AxeBuilder from './fixtures/axe';
import { expect, test } from '@playwright/test';

import { LOCALES, messages, rejectOptionalCookies } from './fixtures/messages';

/**
 * 0162 — `/candidate/zapisane` na serwerze fixture (`savedJobsFixture`: 2 oferty publiczne +
 * zamknięta, wygasła, wstrzymana, niedostępna). Oferta bez strony publicznej: etykieta stanu,
 * tytuł i firma, ŻADNEGO linku do `/oferty-pracy/…` (404) i „Usuń z zapisanych”.
 * Kontrola ujemna: oferty publiczne nadal linkują — selektor linków działa.
 */

type Dashboard = Record<string, string>;
const STATE_KEYS = ['savedStateClosed', 'savedStateExpired', 'savedStatePaused', 'savedStateUnavailable'] as const;

for (const locale of LOCALES) {
  test(`saved jobs without a public page keep a card without dead link in ${locale}`, async ({ page }) => {
    const d = messages(locale).dashboard as unknown as Dashboard;
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto(`/${locale}/candidate/zapisane`);
    await rejectOptionalCookies(page, locale);
    await expect(page.getByRole('heading', { level: 1, name: d['navSaved'] })).toBeVisible();

    const main = page.getByRole('main');
    const cards = main.getByRole('listitem');
    await expect(cards).toHaveCount(6);

    // Kontrola ujemna: dwie oferty publiczne mają link — i tylko one.
    const jobLinks = main.locator('a[href*="/oferty-pracy/"]');
    await expect(jobLinks).toHaveCount(2);

    for (const key of STATE_KEYS) {
      const card = cards.filter({ hasText: d[key]! });
      await expect(card).toHaveCount(1);
      await expect(card.getByRole('heading', { level: 3 })).not.toHaveText('');
      await expect(card.getByRole('link')).toHaveCount(0);
      await expect(card.getByRole('button', { name: new RegExp(`^${escape(d['savedRemove']!)}`) })).toBeVisible();
    }

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    const axe = await new AxeBuilder({ page })
      .include('main')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(axe.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);

    // Usunięcie zamkniętej oferty: komunikat z fokusem, karta stanu znika, reszta zostaje.
    await page.waitForLoadState('networkidle');
    const closed = cards.filter({ hasText: d['savedStateClosed']! });
    const title = (await closed.getByRole('heading', { level: 3 }).textContent())?.trim() ?? '';
    await closed.getByRole('button', { name: new RegExp(`^${escape(d['savedRemove']!)}`) }).click();
    const status = cards.getByRole('status');
    await expect(status).toHaveText(d['savedRemoved']!.replace('{title}', title));
    await expect(status).toBeFocused();
    await expect(cards.filter({ hasText: d['savedStateClosed']! })).toHaveCount(0);
    await expect(cards.filter({ hasText: d['savedStateExpired']! })).toHaveCount(1);
    await expect(jobLinks).toHaveCount(2);
  });
}

/**
 * #816 — porównanie 2–3 zapisanych ofert: wybór checkboxami (formularz GET), tabela z nagłówkami,
 * limit 3, oferta niedostępna w zestawieniu bez linku, axe i brak przewijania strony na 320 px.
 */
for (const locale of LOCALES) {
  test(`compares saved jobs in one keyboard-accessible table in ${locale}`, async ({ page }) => {
    const d = messages(locale).dashboard as unknown as Dashboard;
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto(`/${locale}/candidate/zapisane`);
    await rejectOptionalCookies(page, locale);
    await page.waitForLoadState('networkidle');

    const main = page.getByRole('main');
    const boxes = main.getByRole('checkbox', { name: new RegExp(`^${escape(d['compareSelect']!)}`) });
    await expect(boxes).toHaveCount(2); // tylko oferty dostępne
    const submit = main.getByRole('button', { name: d['compareSubmit']! });
    await expect(submit).toBeDisabled();
    await boxes.nth(0).check();
    await expect(submit).toBeDisabled();
    await boxes.nth(1).check();
    await expect(submit).toBeEnabled();
    await submit.click();

    await expect(page).toHaveURL(/porownaj=/);
    const table = main.getByRole('table');
    await expect(table).toBeVisible();
    await expect(table.getByRole('columnheader')).toHaveCount(3); // pusta kolumna warunków + 2 oferty
    await expect(table.getByRole('rowheader')).toHaveCount(7);
    await expect(table.getByRole('rowheader', { name: d['compareRowSalary']! })).toBeVisible();
    // Zaznaczenie przeżywa wysłanie formularza.
    await expect(boxes.nth(0)).toBeChecked();
    await expect(boxes.nth(1)).toBeChecked();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    const axe = await new AxeBuilder({ page })
      .include('main')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(axe.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);

    // Oferta zamknięta w zestawieniu: kolumna ze stanem, bez linku do strony 404.
    const ids = ['cccccccc-cccc-4ccc-8ccc-000000000001', 'cccccccc-cccc-4ccc-8ccc-000000000002'];
    await page.goto(`/${locale}/candidate/zapisane?porownaj=${ids.join(',')}`);
    const closedTable = page.getByRole('main').getByRole('table');
    await expect(closedTable.getByRole('columnheader')).toHaveCount(3);
    await expect(closedTable.getByText(d['savedStateClosed']!)).toBeVisible();
    await expect(closedTable.locator('a[href*="/oferty-pracy/"]')).toHaveCount(1);

    // Jedna oferta to za mało na porównanie: komunikat, bez tabeli.
    await page.goto(`/${locale}/candidate/zapisane?porownaj=${ids[0]}`);
    await expect(page.getByRole('main').getByText(d['compareNeedTwo']!)).toBeVisible();
    await expect(page.getByRole('main').getByRole('table')).toHaveCount(0);
  });
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

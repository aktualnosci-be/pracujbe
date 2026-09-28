import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test } from '@playwright/test';

import { LOCALES, rejectOptionalCookies } from './fixtures/messages';

/**
 * Przegląd retencji danych w panelu admina (#486/#574, `/admin/ustawienia/retencja`) w trybie
 * DEMO: wartości startowe z migracji 0127/0132, tryby crona z env serwera testowego (bez
 * `RETENTION_MODE`/`DSA_RETENTION_MODE`/`STORAGE_GC_MODE` → wyłączone / tylko liczniki).
 * Strona jest tylko do odczytu — nie ma na niej żadnego formularza ani przycisku zapisu.
 */

type Messages = {
  admin: Record<string, string>;
  adminRetention: {
    title: string;
    demoNotice: string;
    modesTitle: string;
    policiesTitle: string;
    storageGcDryRun: string;
    mode: Record<string, string>;
    keys: Record<string, { label: string; description: string }>;
  };
};
const msgs = (locale: string) =>
  JSON.parse(readFileSync(resolve(process.cwd(), 'src', 'messages', `${locale}.json`), 'utf-8')) as Messages;

for (const locale of LOCALES) {
  test(`admin: retencja danych — okresy, tryby, bez formularzy (${locale})`, async ({ page }) => {
    const m = msgs(locale);
    const t = m.adminRetention;

    await page.goto(`/${locale}/admin/ustawienia`);
    await rejectOptionalCookies(page, locale);
    await page.getByRole('link', { name: m.admin.retentionLinkCta }).click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/admin/ustawienia/retencja$`));

    await expect(page.getByRole('heading', { level: 1, name: t.title })).toBeVisible();
    await expect(page.getByText(t.demoNotice)).toBeVisible();

    const modes = page.getByRole('region', { name: t.modesTitle });
    await expect(modes.getByText(t.mode.off!)).toHaveCount(2);
    await expect(modes.getByText(t.storageGcDryRun)).toBeVisible();

    const policies = page.getByRole('region', { name: t.policiesTitle });
    await expect(policies.getByRole('article')).toHaveCount(Object.keys(t.keys).length);
    await expect(policies.getByRole('heading', { level: 3, name: t.keys.closed_application!.label })).toBeVisible();

    // Tylko odczyt: żadnego pola ani przycisku zapisu w treści strony.
    const main = page.locator('#main-content');
    await expect(main.getByRole('textbox')).toHaveCount(0);
    await expect(main.getByRole('button')).toHaveCount(0);
  });
}

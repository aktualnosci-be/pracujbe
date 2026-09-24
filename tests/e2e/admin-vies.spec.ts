import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { LOCALES, rejectOptionalCookies } from './fixtures/messages';

/**
 * #92 — sekcja VIES w szczególe firmy (tryb DEMO, bez zapytań do VIES).
 *
 * Numer z poprawną sumą kontrolną: stan „nie sprawdzono” + przycisk; kliknięcie w trybie
 * demo ogłasza komunikat w regionie statusu, a status firmy się nie zmienia. Numer z błędną
 * sumą kontrolną: komunikat o błędzie zapisu i brak przycisku (kontrola ujemna — nic nie
 * trafia do VIES). Teksty z `src/messages`.
 */

type AdminMessages = Record<string, string>;

function admin(locale: string): AdminMessages {
  const all = JSON.parse(
    readFileSync(resolve(process.cwd(), 'src', 'messages', `${locale}.json`), 'utf-8'),
  ) as { admin: AdminMessages };
  return all.admin;
}

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function blockingViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return results.violations
    .filter((v) => v.impact === 'critical' || v.impact === 'serious')
    .map((v) => `[${v.impact}] ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
}

for (const locale of LOCALES) {
  const t = admin(locale);

  test(`admin #92: VIES — numer do sprawdzenia, ręczne sprawdzenie w demo (${locale})`, async ({
    page,
  }) => {
    const viesRequests: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('ec.europa.eu')) viesRequests.push(req.url());
    });

    await page.goto(`/${locale}/admin/firmy/demo-c3`);
    await rejectOptionalCookies(page, locale);

    const section = page.getByRole('region', { name: t.viesHeading });
    await expect(section).toBeVisible();
    await expect(section.getByText(t.viesIntro)).toBeVisible();
    await expect(section.getByText(t.viesNotChecked)).toBeVisible();

    const check = section.getByRole('button', { name: t.viesCheckAction });
    await check.click();
    await expect(section.getByRole('status')).toHaveText(t.viesDemo);
    await expect(section.getByText(t.viesStateInvalid)).toHaveCount(0);

    const statusSection = page.getByRole('region', { name: t.sectionStatus });
    await expect(statusSection.getByRole('button', { name: t.actionVerify })).toBeVisible();

    expect(viesRequests).toEqual([]);
    expect(await blockingViolations(page)).toEqual([]);
  });

  test(`admin #92: VIES — błędna suma kontrolna bez zapytania (${locale})`, async ({ page }) => {
    await page.goto(`/${locale}/admin/firmy/demo-c2`);
    await rejectOptionalCookies(page, locale);

    const section = page.getByRole('region', { name: t.viesHeading });
    await expect(section.getByText(t.viesFormatChecksum)).toBeVisible();
    await expect(section.getByRole('button', { name: t.viesCheckAction })).toHaveCount(0);
    await expect(section.getByText(t.viesStateInvalid)).toHaveCount(0);
  });
}

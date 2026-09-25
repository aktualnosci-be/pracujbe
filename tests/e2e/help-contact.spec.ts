import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { LOCALES, rejectOptionalCookies } from './fixtures/messages';

/**
 * #61 — Pomoc i Kontakt na buildzie produkcyjnym, w PL/NL/FR/EN: realna treść (bez atrapy
 * „w przygotowaniu”), strony indeksowalne z canonical/hreflang, pytania FAQ rozwijane
 * klawiaturą, formularz kontaktu dostępny (axe, 320 px bez poziomego przewijania). Wysyłkę
 * formularza sprawdza `contact-form.spec.ts` na serwerze fixture. Kontrola ujemna: polityka
 * prywatności zostaje placeholderem z noindex.
 */

type Msgs = {
  help: { title: string; faq: { noCv: { q: string; a: string } } };
  contact: { title: string; formTitle: string; submit: string };
  legal: { placeholder: string };
};
const messages = Object.fromEntries(
  LOCALES.map((l) => [l, JSON.parse(readFileSync(resolve(process.cwd(), 'src', 'messages', `${l}.json`), 'utf-8')) as Msgs]),
) as Record<(typeof LOCALES)[number], Msgs>;

async function blockingViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  return results.violations
    .filter((v) => v.impact === 'critical' || v.impact === 'serious')
    .map((v) => `[${v.impact}] ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
}

for (const locale of LOCALES) {
  const t = messages[locale];

  test(`${locale}: Pomoc — treść, SEO, FAQ klawiaturą, axe 320 px`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`/${locale}/pomoc`);
    await rejectOptionalCookies(page, locale);
    await expect(page.getByRole('heading', { level: 1, name: t.help.title })).toBeVisible();
    await expect(page.getByText(t.legal.placeholder)).toHaveCount(0);
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', new RegExp(`/${locale}/pomoc$`));
    for (const alt of LOCALES) {
      await expect(page.locator(`link[rel="alternate"][hreflang="${alt}"]`)).toHaveAttribute('href', new RegExp(`/${alt}/pomoc$`));
    }

    // Natywne <details>: fokus na <summary> (Tab), Enter rozwija odpowiedź.
    const question = page.locator('summary', { hasText: t.help.faq.noCv.q });
    const answerStart = t.help.faq.noCv.a.split('<')[0]!.trim();
    await expect(page.getByText(answerStart, { exact: false })).toBeHidden();
    await question.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText(answerStart, { exact: false })).toBeVisible();

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await blockingViolations(page)).toEqual([]);
  });

  test(`${locale}: Kontakt — formularz, SEO, axe 320 px`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`/${locale}/kontakt`);
    await rejectOptionalCookies(page, locale);
    await expect(page.getByRole('heading', { level: 1, name: t.contact.title })).toBeVisible();
    await expect(page.getByRole('form', { name: t.contact.formTitle })).toBeVisible();
    await expect(page.getByRole('button', { name: t.contact.submit })).toBeEnabled();
    await expect(page.getByText(t.legal.placeholder)).toHaveCount(0);
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', new RegExp(`/${locale}/kontakt$`));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await blockingViolations(page)).toEqual([]);
  });
}

test('kontrola ujemna: polityka prywatności nadal placeholder z noindex', async ({ page }) => {
  await page.goto('/pl/polityka-prywatnosci');
  await expect(page.getByText(messages.pl.legal.placeholder)).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
});

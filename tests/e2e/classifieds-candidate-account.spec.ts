import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import AxeBuilder from './fixtures/axe';
import { LOCALES, rejectOptionalCookies } from './fixtures/messages';

/**
 * Konto kandydata w trybie ogłoszeniowym (#1142, #1145; epik #1128) — decyzja produktowa:
 * portal ogłoszeniowy. Bez profilu zawodowego: kreator i profil = 404, nawigacja = pulpit,
 * zapisane oferty, zapisane wyszukiwania, ustawienia; pulpit bez kompletności i podglądów;
 * preferencje e-mail bez kategorii rekrutacyjnych.
 *
 * Wymaga serwera w trybie ogłoszeniowym: `E2E_PORTAL_LEGAL_MODE= npx playwright test
 * classifieds-candidate-account`. Domyślny przebieg (serwer `RECRUITMENT`) pomija plik —
 * pełny panel pokrywają `panel-a11y`, onboarding i `candidate-*`.
 */

const classifieds = (process.env.E2E_PORTAL_LEGAL_MODE ?? 'RECRUITMENT').trim().toUpperCase() !== 'RECRUITMENT';
test.skip(!classifieds, 'serwer testowy w trybie RECRUITMENT (E2E_PORTAL_LEGAL_MODE=)');

type Texts = {
  dashboard: Record<'profileCompleteness' | 'accountIntro' | 'navSaved' | 'navSearches' | 'navSettings' | 'navSummary', string>;
  settings: Record<'emailApplicationsLabel' | 'emailOffersLabel' | 'emailMessagesLabel' | 'emailJobMatchesLabel', string>;
  files: Record<'existingTitle' | 'existingHint' | 'upload', string>;
};
const texts = (locale: string): Texts =>
  JSON.parse(readFileSync(resolve(process.cwd(), 'src', 'messages', `${locale}.json`), 'utf-8')) as Texts;

const BLOCKING = new Set(['critical', 'serious']);
async function audit(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  return results.violations
    .filter((v) => BLOCKING.has(v.impact ?? ''))
    .map((v) => `[${v.impact}] ${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
}

for (const locale of LOCALES) {
  test(`kreator i profil zawodowy = 404 (${locale})`, async ({ page }) => {
    for (const path of ['candidate/onboarding', 'candidate/onboarding?step=3', 'candidate/onboarding?step=6', 'candidate/profil']) {
      const res = await page.goto(`/${locale}/${path}`);
      expect(res?.status(), path).toBe(404);
    }
  });

  test(`pulpit i nawigacja konta bez profilu zawodowego (${locale})`, async ({ page }) => {
    const t = texts(locale);
    await page.goto(`/${locale}/candidate`);
    await expect(page.locator('main h1')).toBeVisible();
    await expect(page.getByTestId('candidate-account-dashboard')).toBeVisible();
    await expect(page.getByText(t.dashboard.profileCompleteness, { exact: true })).toHaveCount(0);
    await expect(page.locator('[role="meter"], [role="progressbar"]')).toHaveCount(0);
    for (const bad of ['/candidate/onboarding', '/candidate/profil', '/candidate/aplikacje', '/candidate/propozycje', '/candidate/wiadomosci', '/candidate/oferty-polecane']) {
      await expect(page.locator(`a[href*="${bad}"]`), bad).toHaveCount(0);
    }
    for (const [label, href] of [
      [t.dashboard.navSummary, '/candidate'],
      [t.dashboard.navSaved, '/candidate/zapisane'],
      [t.dashboard.navSearches, '/candidate/wyszukiwania'],
      [t.dashboard.navSettings, '/candidate/ustawienia'],
    ] as const) {
      expect(await page.locator(`a[href="/${locale}${href}"]`).filter({ hasText: label }).count(), label).toBeGreaterThan(0);
    }
  });

  test(`ustawienia: preferencje bez kategorii rekrutacyjnych (${locale})`, async ({ page }) => {
    const t = texts(locale);
    await page.goto(`/${locale}/candidate/ustawienia`);
    await expect(page.locator('main h1')).toBeVisible();
    await expect(page.getByLabel(t.settings.emailJobMatchesLabel, { exact: true })).toBeVisible();
    for (const label of [t.settings.emailApplicationsLabel, t.settings.emailOffersLabel, t.settings.emailMessagesLabel]) {
      await expect(page.getByLabel(label, { exact: true }), label).toHaveCount(0);
    }
  });

  test(`ustawienia: lista wcześniej wgranych CV bez wgrywania (#1226, ${locale})`, async ({ page }) => {
    const t = texts(locale);
    await page.goto(`/${locale}/candidate/ustawienia`);
    const section = page.getByRole('region', { name: t.files.existingTitle });
    await expect(section).toBeVisible();
    await expect(section.getByRole('heading', { level: 2, name: t.files.existingTitle })).toBeVisible();
    await expect(section.getByText(t.files.existingHint, { exact: true })).toBeVisible();
    await expect(section.getByRole('button', { name: t.files.upload, exact: true })).toHaveCount(0);
    await expect(page.locator('input[type="file"]')).toHaveCount(0);
  });
}

for (const width of [320, 1280]) {
  for (const locale of LOCALES) {
    test(`axe: pulpit i ustawienia konta (${locale}, ${width} px)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/${locale}/candidate`);
      await rejectOptionalCookies(page, locale);
      await expect(page.locator('main h1')).toBeVisible();
      expect(await audit(page), `${locale} /candidate`).toEqual([]);
      await page.goto(`/${locale}/candidate/ustawienia`);
      await expect(page.locator('main h1')).toBeVisible();
      expect(await audit(page), `${locale} /candidate/ustawienia`).toEqual([]);
    });
  }
}

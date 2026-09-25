import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { LOCALES } from './fixtures/messages';

/**
 * Ustawienia kandydata — zablokowane firmy (#97), tryb DEMO (bez bazy).
 *
 * Demo pokazuje jedną przykładową blokadę. Odblokowanie: przycisk nazwany firmą, jedno
 * żądanie naraz, sukces `role="status"`, fokus wraca na nagłówek sekcji, lista pustoszeje
 * do komunikatu „brak blokad". Bramka axe WCAG 2.x A/AA (critical/serious) przy 320 px
 * bez poziomego przewijania. Egzekwowanie blokady w bazie: supabase/tests/rls.sql sekcja BL.
 */

type Messages = {
  settings: { title: string };
  companyBlocks: { sectionTitle: string; unblockNamed: string; unblockedSuccess: string; empty: string };
};

const DEMO_COMPANY = 'Kortrijk Techniek BV';
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const BLOCKING = new Set(['critical', 'serious']);

function messages(locale: string): Messages {
  return JSON.parse(readFileSync(resolve('src/messages', `${locale}.json`), 'utf8')) as Messages;
}

function fill(template: string, company: string): string {
  return template.replace('{company}', company);
}

async function acceptNecessaryCookies(page: Page): Promise<void> {
  await page.context().addCookies([
    {
      name: 'pracujbe_consent',
      value: JSON.stringify({
        v: process.env.NEXT_PUBLIC_CONSENT_POLICY_VERSION ?? '2.0',
        categories: { necessary: true, preferences: false, analytics: false, marketing: false },
        ts: '2026-01-01T00:00:00.000Z',
        id: 'candidate-company-blocks-e2e',
      }),
      url: 'http://localhost:3000',
      sameSite: 'Lax',
    },
  ]);
}

for (const locale of LOCALES) {
  test(`${locale}: odblokowanie firmy w ustawieniach kandydata (#97)`, async ({ page }) => {
    const m = messages(locale);
    await acceptNecessaryCookies(page);
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto(`/${locale}/candidate/ustawienia`);

    await expect(page.getByRole('heading', { level: 1, name: m.settings.title })).toBeVisible();
    const section = page.getByRole('region', { name: m.companyBlocks.sectionTitle });
    await expect(section).toBeVisible();

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    const blocking = results.violations
      .filter((v) => BLOCKING.has(v.impact ?? ''))
      .map((v) => `[${v.impact}] ${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(', ')}`);
    expect(blocking, blocking.join('\n')).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);

    const unblock = section.getByRole('button', { name: fill(m.companyBlocks.unblockNamed, DEMO_COMPANY) });
    await unblock.click();

    await expect(section.getByRole('status')).toHaveText(fill(m.companyBlocks.unblockedSuccess, DEMO_COMPANY));
    await expect(section.getByRole('heading', { level: 2, name: m.companyBlocks.sectionTitle })).toBeFocused();
    await expect(section.getByText(m.companyBlocks.empty)).toBeVisible();
    await expect(unblock).toHaveCount(0);
    await expect(section.getByRole('alert')).toHaveCount(0);
  });
}

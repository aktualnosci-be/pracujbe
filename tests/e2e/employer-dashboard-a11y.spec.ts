import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { LOCALES } from './fixtures/messages';

/**
 * Pulpit pracodawcy (#157, #164, #171) — bramka axe-core i 200% tekstu (tryb DEMO).
 *
 * Pulpit łączy karty ofert, najnowsze zgłoszenia z menu statusu i top kandydatów; żadna
 * z publicznych bramek a11y go nie obejmuje. Blokujemy naruszenia WCAG 2.x A/AA o wadze
 * critical/serious przy 320 i 1280 px oraz przy `html { font-size: 200% }`; w tym ostatnim
 * dodatkowo nic w `main` nie może wystawać poza viewport.
 */

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const BLOCKING = new Set(['critical', 'serious']);

async function acceptNecessaryCookies(page: Page): Promise<void> {
  await page.context().addCookies([
    {
      name: 'pracujbe_consent',
      value: JSON.stringify({
        v: process.env.NEXT_PUBLIC_CONSENT_POLICY_VERSION ?? '1.0',
        categories: { necessary: true, preferences: false, analytics: false, marketing: false },
        ts: '2026-01-01T00:00:00.000Z',
        id: 'employer-dashboard-a11y-e2e',
      }),
      url: 'http://localhost:3000',
      sameSite: 'Lax',
    },
  ]);
}

async function blockingViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return results.violations
    .filter((v) => BLOCKING.has(v.impact ?? ''))
    .map((v) => `[${v.impact}] ${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(', ')}`);
}

async function openDashboard(page: Page, locale: string, width: number) {
  await acceptNecessaryCookies(page);
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`/${locale}/employer`);
  await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();
}

for (const locale of LOCALES) {
  for (const width of [320, 1280]) {
    test(`${locale}: pulpit pracodawcy bez blokujących naruszeń axe przy ${width} px`, async ({ page }) => {
      await openDashboard(page, locale, width);
      expect(await blockingViolations(page)).toEqual([]);
    });
  }

  test(`${locale}: pulpit pracodawcy przy 200% tekstu — axe i brak wystających elementów`, async ({ page }) => {
    await openDashboard(page, locale, 1280);
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });

    expect(await blockingViolations(page)).toEqual([]);
    const report = await page.evaluate(() => {
      const viewportWidth = document.documentElement.clientWidth;
      const offenders = [...document.querySelectorAll<HTMLElement>('main *')]
        .filter((el) => {
          const b = el.getBoundingClientRect();
          return b.width > 0 && b.height > 0 && (b.left < -1 || b.right > viewportWidth + 1);
        })
        .slice(0, 5)
        .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 80)}`);
      return { scrollWidth: document.documentElement.scrollWidth, viewportWidth, offenders };
    });
    const evidence = JSON.stringify(report, null, 2);
    expect(report.scrollWidth, evidence).toBeLessThanOrEqual(report.viewportWidth + 1);
    expect(report.offenders, evidence).toEqual([]);
  });
}

test('kontrola ujemna: bramka wykrywa przycisk bez nazwy w karcie oferty', async ({ page }) => {
  await openDashboard(page, 'pl', 1280);
  await page.locator('main article').first().evaluate((card) => {
    const button = document.createElement('button');
    button.type = 'button';
    card.appendChild(button);
  });
  const violations = await blockingViolations(page);
  expect(violations.some((v) => v.includes('button-name'))).toBe(true);
});

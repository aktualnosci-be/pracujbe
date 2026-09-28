import AxeBuilder from './fixtures/axe';
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Narzędzia rekrutera (0940) w trybie demo: filtry listy zgłoszeń w adresie (formularz GET,
 * działa bez JS) i strona szablonów odpowiedzi — axe WCAG 2.x A/AA (critical/serious +
 * `target-size`) w 4 językach przy 320 i 1280 px. Akcję zbiorczą i szablony na realnej bazie
 * sprawdzają `tests/integration/portal-recruiter-tools.test.ts` i `rls.sql` (RT940).
 */

const LOCALES = ['pl', 'nl', 'fr', 'en'] as const;
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

type Copy = {
  dashboard: Record<string, string>;
  messageTemplates: Record<string, unknown>;
  status: Record<string, string>;
};

function copy(locale: string): Copy {
  return JSON.parse(readFileSync(resolve(process.cwd(), 'src', 'messages', `${locale}.json`), 'utf-8')) as Copy;
}

async function storeConsent(page: Page, baseURL: string) {
  await page.context().addCookies([{
    name: 'pracujbe_consent',
    value: JSON.stringify({
      v: process.env.NEXT_PUBLIC_CONSENT_POLICY_VERSION ?? '2.0',
      categories: { necessary: true, preferences: false, analytics: false },
      ts: '2026-01-01T00:00:00.000Z',
      id: 'recruiter-tools-e2e',
    }),
    url: baseURL,
    sameSite: 'Lax',
  }]);
}

async function audit(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page })
    .options({ rules: { 'target-size': { enabled: true } } })
    .withTags(WCAG_TAGS)
    .analyze();
  return results.violations
    .filter((v) => v.impact === 'critical' || v.impact === 'serious' || v.id === 'target-size')
    .map((v) => `[${v.impact}] ${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
}

for (const width of [1280, 320] as const) {
  for (const locale of LOCALES) {
    test(`narzędzia rekrutera: filtry zgłoszeń i szablony (${locale}, ${width} px)`, async ({ page, baseURL }) => {
      await page.setViewportSize({ width, height: 900 });
      await storeConsent(page, baseURL ?? 'http://localhost:3000');
      const c = copy(locale);

      await page.goto(`/${locale}/employer/aplikacje`);
      const form = page.getByRole('form', { name: c.dashboard.employerApplicationsFilterLabel });
      await expect(form).toBeVisible();
      await form.getByRole('combobox', { name: c.dashboard.employerApplicationsFilterStatus })
        .selectOption('hired');
      await form.getByRole('button', { name: c.dashboard.employerApplicationsFilterApply }).click();
      await expect(page).toHaveURL(/[?&]status=hired/);
      await expect(page.getByRole('link', { name: c.dashboard.employerApplicationsFilterClear })).toBeVisible();
      expect(await audit(page)).toEqual([]);

      await page.goto(`/${locale}/employer/szablony`);
      await expect(page.getByRole('heading', { level: 1, name: String(c.messageTemplates.title) })).toBeVisible();
      expect(await audit(page)).toEqual([]);
    });
  }
}

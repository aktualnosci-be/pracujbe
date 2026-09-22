import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const locales = ['pl', 'nl', 'fr', 'en'] as const;
const panels = [
  { name: 'profil kandydata', path: 'candidate/profil' },
  { name: 'firma pracodawcy', path: 'employer/firma' },
  { name: 'kreator oferty', path: 'employer/oferty/nowa' },
] as const;

const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

for (const locale of locales) {
  for (const panel of panels) {
    test(`${panel.name}: dostępność ${locale} przy 320 px`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 800 });
      await page.context().addCookies([{
        name: 'pracujbe_consent',
        value: JSON.stringify({
          v: process.env.NEXT_PUBLIC_CONSENT_POLICY_VERSION ?? '1.0',
          categories: { necessary: true, preferences: false, analytics: false, marketing: false },
          ts: '2026-01-01T00:00:00.000Z',
          id: 'passport-panel-a11y-e2e',
        }),
        url: 'http://localhost:3000',
        sameSite: 'Lax',
      }]);
      await page.goto(`/${locale}/${panel.path}`);

      const main = page.getByRole('main');
      await expect(main.getByRole('heading', { level: 1 })).toBeVisible();
      const firstField = main.getByRole('textbox').first();
      if (await firstField.count()) {
        await firstField.focus();
        await expect(firstField).toBeFocused();
        const focusStyle = await firstField.evaluate((element) => ({
          outlineStyle: getComputedStyle(element).outlineStyle,
          boxShadow: getComputedStyle(element).boxShadow,
        }));
        expect(
          focusStyle.outlineStyle !== 'none' || focusStyle.boxShadow !== 'none',
          `${locale}/${panel.path}: fokus pola formularza musi być widoczny`,
        ).toBe(true);
      }

      const result = await new AxeBuilder({ page }).withTags(tags).analyze();
      const blocking = result.violations.filter((violation) =>
        violation.impact === 'critical' || violation.impact === 'serious',
      );
      expect(
        blocking.map((violation) => ({
          id: violation.id,
          impact: violation.impact,
          targets: violation.nodes.slice(0, 3).map((node) => node.target),
        })),
        `${locale}/${panel.path}: naruszenia axe critical/serious`,
      ).toEqual([]);
    });
  }
}

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const locales = ['pl', 'nl', 'fr', 'en'] as const;
const panels = [
  { name: 'pulpit kandydata', path: 'candidate', fullAudit: false },
  { name: 'profil kandydata', path: 'candidate/profil', fullAudit: true },
  { name: 'pulpit pracodawcy', path: 'employer', fullAudit: false },
  { name: 'firma pracodawcy', path: 'employer/firma', fullAudit: true },
  { name: 'kreator oferty', path: 'employer/oferty/nowa', fullAudit: true },
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
      const focusTarget = panel.path === 'candidate/profil' || panel.path === 'candidate' || panel.path === 'employer'
        ? main.getByRole('link').first()
        : main.getByRole('textbox').first();
      await expect(focusTarget).toBeVisible();
      await page.keyboard.press('Tab');
      await focusTarget.focus();
      await expect(focusTarget).toBeFocused();
      const focusStyle = await focusTarget.evaluate((element) => ({
        outlineStyle: getComputedStyle(element).outlineStyle,
        boxShadow: getComputedStyle(element).boxShadow,
      }));
      expect(
        focusStyle.outlineStyle !== 'none' || focusStyle.boxShadow !== 'none',
        `${locale}/${panel.path}: fokus elementu sterującego musi być widoczny`,
      ).toBe(true);

      // target-size (WCAG 2.2 SC 2.5.8) jest w axe domyślnie wyłączone.
      // Sprawdzamy je osobno, bo jego wpływ bywa moderate i wtedy zwykły
      // filtr critical/serious ukryłby rzeczywiste naruszenie.
      const result = await new AxeBuilder({ page })
        .options({ rules: { 'target-size': { enabled: true } } })
        .withTags(tags)
        .analyze();
      const blocking = result.violations.filter((violation) =>
        violation.impact === 'critical' || violation.impact === 'serious',
      );
      // Zachowaj wcześniejszą bramkę axe dla trzech istniejących tras.
      // Dashboardy dodajemy tu wyłącznie do bramki target-size; ich pełny
      // audyt kontrastu wymaga osobnej poprawki produktu.
      if (panel.fullAudit) {
        expect(
          blocking.map((violation) => ({
            id: violation.id,
            impact: violation.impact,
            targets: violation.nodes.slice(0, 3).map((node) => node.target),
          })),
          `${locale}/${panel.path}: naruszenia axe critical/serious`,
        ).toEqual([]);
      }
      const targetSize = result.violations.filter((violation) => violation.id === 'target-size');
      expect(
        targetSize.map((violation) => violation.nodes.slice(0, 5).map((node) => node.target)),
        `${locale}/${panel.path}: cele dotykowe WCAG 2.2 AA muszą mieć wymagany rozmiar lub odstęp`,
      ).toEqual([]);
    });
  }
}

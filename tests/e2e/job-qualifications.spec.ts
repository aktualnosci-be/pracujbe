import { expect, test } from '@playwright/test';

import en from '../../src/messages/en.json';
import fr from '../../src/messages/fr.json';
import nl from '../../src/messages/nl.json';
import pl from '../../src/messages/pl.json';
import { AxeBuilder } from './fixtures/axe';

/**
 * #866 (decyzja właściciela 01.10.2026): szczegół oferty pokazuje umiejętności i certyfikaty,
 * po których kandydat znalazł ofertę. Tryb demo: oferta 1001 ma umiejętności wymagane, mile
 * widziane i certyfikat (nazwy umiejętności w języku widza), oferta 1003 nie ma żadnych —
 * kontrola ujemna: bez kwalifikacji nie ma sekcji ani pustego nagłówka. Odczyt z PostgreSQL
 * (RLS anon) dowodzi `tests/integration/public-job-qualifications.test.ts`.
 */
const locales = { pl, nl, fr, en } as const;
const WITH_QUALIFICATIONS = '/oferty-pracy/warehouse-worker-antwerp-1001';
const WITHOUT_QUALIFICATIONS = '/oferty-pracy/truck-driver-ghent-1003';
const SKILLS = {
  pl: { mandatory: ['Kompletowanie zamówień', 'Obsługa skanera ręcznego'], optional: ['Obsługa wózka widłowego'] },
  nl: { mandatory: ['Orderpicking', 'Werken met een handscanner'], optional: ['Heftruck rijden'] },
  fr: { mandatory: ['Préparation de commandes', 'Utilisation d’un scanner portable'], optional: ['Conduite de chariot élévateur'] },
  en: { mandatory: ['Order picking', 'Handheld scanner operation'], optional: ['Forklift operation'] },
} as const;

for (const [locale, m] of Object.entries(locales) as [keyof typeof locales, typeof pl][]) {
  for (const width of [320, 1280] as const) {
    test(`szczegół oferty: umiejętności i certyfikaty (${locale}, ${width} px)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/${locale}${WITH_QUALIFICATIONS}`);
      await page.getByRole('button', { name: m.cookies.rejectOptional }).click();

      const section = page.getByTestId('job-qualifications');
      await expect(page.getByRole('heading', { level: 2, name: m.job.qualifications.title })).toBeVisible();
      const mandatory = section.locator('[data-qualification-group="skillsMandatory"]');
      await expect(mandatory.locator('dt')).toHaveText(m.job.qualifications.skillsMandatory);
      await expect(mandatory.getByRole('listitem')).toHaveText([...SKILLS[locale].mandatory]);
      const optional = section.locator('[data-qualification-group="skillsOptional"]');
      await expect(optional.locator('dt')).toHaveText(m.job.qualifications.skillsOptional);
      await expect(optional.getByRole('listitem')).toHaveText([...SKILLS[locale].optional]);
      const certificates = section.locator('[data-qualification-group="certificates"]');
      await expect(certificates.locator('dt')).toHaveText(m.job.qualifications.certificates);
      await expect(certificates.getByRole('listitem')).toHaveText(['VCA Basis']);

      // Bez poziomego przewijania strony przy 320 px.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);

      const results = await new AxeBuilder({ page })
        .include('[data-testid="job-qualifications"]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
    });
  }
}

test('kontrola ujemna: oferta bez umiejętności i certyfikatów nie ma sekcji', async ({ page }) => {
  await page.goto(`/pl${WITHOUT_QUALIFICATIONS}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByTestId('job-qualifications')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 2, name: pl.job.qualifications.title })).toHaveCount(0);
});

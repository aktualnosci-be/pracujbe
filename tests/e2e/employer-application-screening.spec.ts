import { expect, test } from '@playwright/test';

import en from '../../src/messages/en.json';
import pl from '../../src/messages/pl.json';

/**
 * #101 — odpowiedzi na pytania screeningowe w szczególe zgłoszenia (tryb demo, zgłoszenie
 * `demo-app-1`). Treść pytań i opcji pochodzi ze snapshotu zapisanego przy aplikacji;
 * odczyt tylko recruiter+ firmy i sam kandydat dowodzi `rls.sql` SQ101-11.
 */
for (const [locale, m, prompt, choice] of [
  ['pl', pl, 'Czy masz uprawnienia SEP?', 'Własnym samochodem'],
  ['en', en, 'Do you hold an SEP certificate?', 'Own car'],
] as const) {
  test(`odpowiedzi kandydata w szczególe zgłoszenia: ${locale}`, async ({ page }) => {
    await page.goto(`/${locale}/employer/aplikacje/demo-app-1`);
    const section = page.getByRole('region', { name: m.dashboard.employerApplicationScreening });
    await expect(section).toBeVisible();
    await expect(section.getByText(m.dashboard.employerApplicationScreeningHint)).toBeVisible();
    await expect(section.getByRole('term').filter({ hasText: prompt })).toBeVisible();
    await expect(section.getByRole('definition').filter({ hasText: choice })).toBeVisible();
    await expect(section.getByRole('definition').filter({ hasText: m.dashboard.employerApplicationScreeningNoAnswer })).toBeVisible();
  });
}

test('zgłoszenie na ofertę bez pytań nie pokazuje sekcji odpowiedzi', async ({ page }) => {
  await page.goto('/pl/employer/aplikacje/demo-app-2');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('region', { name: pl.dashboard.employerApplicationScreening })).toHaveCount(0);
});

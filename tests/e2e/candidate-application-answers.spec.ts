import { expect, test, type Page } from '@playwright/test';

import en from '../../src/messages/en.json';
import fr from '../../src/messages/fr.json';
import nl from '../../src/messages/nl.json';
import pl from '../../src/messages/pl.json';
import { rejectOptionalCookies } from './fixtures/messages';

/**
 * #101 — kandydat widzi w historii zgłoszeń pytania screeningowe i własne odpowiedzi
 * (tryb demo: zgłoszenie `demo-app-0` ma snapshot 4 pytań z tłumaczeniami). Odczyt pod
 * sesją/RLS dowodzą `tests/integration/portal-candidate.test.ts` i `rls.sql` SQ101-11.
 */
const COPY = { pl, nl, fr, en } as const;
const EXPECTED = {
  pl: { prompt: 'Na którą zmianę możesz pracować?', choice: 'Nocna', yes: pl.dashboard.employerApplicationYes },
  nl: { prompt: 'Welke ploeg kun je werken?', choice: 'Nachtploeg', yes: nl.dashboard.employerApplicationYes },
  fr: { prompt: 'Quelle équipe pouvez-vous faire ?', choice: 'Nuit', yes: fr.dashboard.employerApplicationYes },
  en: { prompt: 'Which shift can you work?', choice: 'Night shift', yes: en.dashboard.employerApplicationYes },
} as const;

function answersToggle(page: Page, locale: keyof typeof COPY) {
  const label = COPY[locale].dashboard.applicationAnswersToggle.replace('{count}', '4');
  return page.getByRole('main').getByRole('button', { name: label, exact: true });
}

for (const locale of Object.keys(COPY) as (keyof typeof COPY)[]) {
  test(`odpowiedzi na pytania w historii zgłoszeń: ${locale}`, async ({ page }) => {
    const m = COPY[locale].dashboard;
    await page.goto(`/${locale}/candidate/aplikacje`);
    await rejectOptionalCookies(page, locale);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    // Tylko zgłoszenie z zapisanymi odpowiedziami ma przycisk (kontrola ujemna: pozostałe karty bez niego).
    await expect(page.getByRole('main').getByRole('button', { name: m.applicationAnswersToggle.split('{count}')[0], exact: false })).toHaveCount(1);
    await page.waitForLoadState('networkidle');

    const toggle = answersToggle(page, locale);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const region = page.getByRole('region', { name: m.applicationAnswersHeading });
    await expect(region.getByText(m.applicationAnswersHint)).toBeVisible();
    await expect(region.getByRole('term')).toHaveCount(4);
    await expect(region.getByRole('term').filter({ hasText: EXPECTED[locale].prompt })).toBeVisible();
    await expect(region.getByRole('definition').filter({ hasText: EXPECTED[locale].choice })).toBeVisible();
    await expect(region.getByRole('definition').filter({ hasText: EXPECTED[locale].yes })).toBeVisible();
    await expect(region.getByRole('definition').filter({ hasText: m.employerApplicationScreeningNoAnswer })).toBeVisible();

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(region).toBeHidden();
  });
}

test('błąd odczytu odpowiedzi: komunikat i ponowienie bez przeładowania strony', async ({ page }) => {
  const m = pl.dashboard;
  await page.goto('/pl/candidate/aplikacje');
  await rejectOptionalCookies(page, 'pl');
  await page.waitForLoadState('networkidle');
  // Server Action = POST na adres strony z nagłówkiem `next-action`.
  let failNext = true;
  await page.route('**/pl/candidate/aplikacje', async (route) => {
    if (route.request().method() === 'POST' && route.request().headers()['next-action'] && failNext) {
      failNext = false;
      await route.abort('failed');
      return;
    }
    await route.continue();
  });

  await answersToggle(page, 'pl').click();
  const region = page.getByRole('region', { name: m.applicationAnswersHeading });
  await expect(region.getByRole('alert')).toHaveText(m.applicationAnswersError);
  await expect(region.getByRole('term')).toHaveCount(0);
  await region.getByRole('button', { name: m.candidateListRetry }).click();
  await expect(region.getByRole('term')).toHaveCount(4);
  await expect(region.getByRole('alert')).toHaveCount(0);
});

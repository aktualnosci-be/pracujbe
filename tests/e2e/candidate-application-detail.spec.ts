import { expect, test } from '@playwright/test';

import en from '../../src/messages/en.json';
import fr from '../../src/messages/fr.json';
import nl from '../../src/messages/nl.json';
import pl from '../../src/messages/pl.json';
import { rejectOptionalCookies } from './fixtures/messages';

/**
 * Szczegół własnego zgłoszenia w panelu kandydata (P1-05/P1-06, strona kandydata) — tryb demo:
 * `demo-app-0` ma snapshot 4 pytań screeningowych. Z karty listy przechodzimy do szczegółu
 * (link nazwany tytułem oferty), widzimy dane zgłoszenia, odpowiedzi i historię, wracamy.
 * Odczyt pod sesją/RLS i kontrola ujemna: `tests/integration/portal-candidate.test.ts`.
 */
const COPY = { pl, nl, fr, en } as const;

for (const locale of Object.keys(COPY) as (keyof typeof COPY)[]) {
  test(`szczegół zgłoszenia z listy i z powrotem: ${locale}`, async ({ page }) => {
    const m = COPY[locale].dashboard;
    await page.goto(`/${locale}/candidate/aplikacje`);
    await rejectOptionalCookies(page, locale);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Karta z odpowiedziami na pytania = demo-app-0 (jedyna z przyciskiem odpowiedzi).
    const toggleLabel = m.applicationAnswersToggle.replace('{count}', '4');
    const card = page.getByRole('main').getByRole('listitem').filter({
      has: page.getByRole('button', { name: toggleLabel, exact: true }),
    });
    const jobTitle = (await card.getByRole('heading', { level: 2 }).textContent())?.trim() ?? '';
    expect(jobTitle.length).toBeGreaterThan(0);
    await card.getByRole('link', { name: m.candidateApplicationDetailsLinkLabel.replace('{job}', jobTitle), exact: true }).click();

    await expect(page).toHaveURL(new RegExp(`/${locale}/candidate/aplikacje/demo-app-0$`));
    await expect(page.getByRole('heading', { level: 1, name: jobTitle })).toBeVisible();
    await expect(page.getByText(m.candidateApplicationDemo)).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: m.employerApplicationSubmission })).toBeVisible();
    const answers = page.getByRole('region', { name: m.applicationAnswersHeading });
    await expect(answers.getByRole('term')).toHaveCount(4);
    await expect(answers.getByRole('definition').filter({ hasText: m.employerApplicationScreeningNoAnswer })).toBeVisible();
    const history = page.getByRole('region', { name: m.employerApplicationHistory });
    await expect(history.getByRole('listitem')).toHaveCount(1);

    await page.getByRole('link', { name: m.candidateApplicationBack, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/candidate/aplikacje$`));
  });
}

test('nieznane zgłoszenie = 404 bez ujawniania danych', async ({ page }) => {
  const response = await page.goto('/pl/candidate/aplikacje/demo-app-99');
  expect(response?.status()).toBe(404);
  await expect(page.getByText(pl.dashboard.candidateApplicationBack)).toHaveCount(0);
});

// 404 panelu leży pod layoutem `/candidate` (src/app/[locale]/candidate/not-found.tsx): kandydat
// zostaje w panelu (menu z sekcjami), a nie na publicznej stronie 404.
for (const locale of Object.keys(COPY) as (keyof typeof COPY)[]) {
  test(`404 w panelu kandydata zostawia menu panelu: ${locale}`, async ({ page }) => {
    const m = COPY[locale].dashboard;
    await page.setViewportSize({ width: 1280, height: 800 });
    const response = await page.goto(`/${locale}/candidate/aplikacje/demo-app-99`);
    expect(response?.status()).toBe(404);
    await rejectOptionalCookies(page, locale);

    const main = page.getByRole('main');
    await expect(main).toHaveCount(1);
    await expect(main.getByRole('heading', { level: 1, name: m.candidateNotFoundTitle })).toBeVisible();
    await expect(main.getByRole('link', { name: m.candidatePanelBackToDashboard })).toHaveAttribute(
      'href',
      `/${locale}/candidate`,
    );
    // Menu panelu (sidebar) nadal jest na stronie — kontrola ujemna: publiczna 404 go nie ma.
    await expect(
      page.getByRole('complementary').getByRole('link', { name: m.navApplications, exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: COPY[locale].errors.notFound })).toHaveCount(0);
    await expect(page.locator('meta[name="robots"]:not([content*="noindex"])')).toHaveCount(0);

    await main.getByRole('link', { name: m.navApplications, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/candidate/aplikacje$`));
  });
}

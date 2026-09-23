import { expect, test } from '@playwright/test';

import en from '../../src/messages/en.json';
import fr from '../../src/messages/fr.json';
import nl from '../../src/messages/nl.json';
import pl from '../../src/messages/pl.json';

/**
 * #244: izolowany serwer dev (TEST_APPLICATIONS_FIXTURE=error) wymusza błąd odczytu liczników,
 * zgłoszeń i wiadomości. Pulpit ma pokazać błąd z ponowieniem, nie „brak danych”, a sekcje
 * odczytane poprawnie (polecane oferty) — prawdziwe dane.
 */
for (const [locale, messages] of Object.entries({ pl, nl, fr, en })) {
  const t = messages.dashboard;

  test(`dashboard read failures show retry, never false empty states (${locale})`, async ({ page }) => {
    await page.goto(`/${locale}/candidate`);

    const applications = page.getByRole('alert').filter({ hasText: t.candidateApplicationsLoadError });
    const conversations = page.getByRole('alert').filter({ hasText: t.candidateMessagesLoadError });
    const counters = page.getByRole('alert').filter({ hasText: t.candidateOverviewLoadError });
    await expect(applications).toBeVisible();
    await expect(conversations).toBeVisible();
    await expect(counters).toBeVisible();
    await expect(page.getByText(t.noApplications, { exact: true })).toHaveCount(0);
    await expect(page.getByText(t.noMessages, { exact: true })).toHaveCount(0);
    await expect(page.getByText(t.candidateStatLoadError, { exact: true })).toHaveCount(3);

    // Sekcja odczytana poprawnie nadal pokazuje dane.
    const recommended = page.locator('section').filter({
      has: page.getByRole('heading', { name: t.recommendedJobs }),
    });
    await expect(recommended.locator('a[href*="/oferty-pracy/"]').first()).toBeVisible();

    await page.waitForLoadState('networkidle');
    const retry = applications.getByRole('button', { name: t.candidateListRetry });
    await retry.focus();
    await expect(retry).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(applications).toBeVisible();
    await expect(page.getByText(t.noApplications, { exact: true })).toHaveCount(0);
  });
}

import { expect, test } from '@playwright/test';

import { rejectOptionalCookies } from './fixtures/messages';

import en from '../../src/messages/en.json';
import fr from '../../src/messages/fr.json';
import nl from '../../src/messages/nl.json';
import pl from '../../src/messages/pl.json';

/**
 * #245: izolowany serwer dev (TEST_APPLICATIONS_FIXTURE=full) podaje 21 propozycji o równym
 * `created_at`. Kandydat dochodzi klawiaturą do najstarszej (#1) przy 320 px, bez powtórzeń.
 */
for (const [locale, messages] of Object.entries({ pl, nl, fr, en })) {
  const t = messages.dashboard;

  test(`candidate proposal history reaches the oldest proposal at 320px (${locale})`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`/${locale}/candidate/propozycje`);
    await rejectOptionalCookies(page, locale);
    await expect(page.getByRole('heading', { level: 1, name: t.navProposals })).toBeVisible();

    const cards = page.getByRole('main').getByRole('article');
    await expect(cards).toHaveCount(10);
    // Serwer dev kompiluje wyspy przy pierwszym wejściu; klik przed hydratacją ginie.
    await page.waitForLoadState('networkidle');

    const more = page.getByRole('button', { name: t.proposalsMore });
    await more.focus();
    await page.keyboard.press('Enter');
    await expect(cards).toHaveCount(20);
    await more.focus();
    await page.keyboard.press('Enter');
    await expect(cards).toHaveCount(21);

    await expect(page.getByText(t.proposalsEnd)).toBeVisible();
    await expect(more).toHaveCount(0);
    await expect(cards.last().locator('a[href*="/oferty-pracy/"]')).toHaveText(/#1$/);
    const titles = await cards.locator('a[href*="/oferty-pracy/"]').allTextContents();
    expect(new Set(titles).size).toBe(21);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
}

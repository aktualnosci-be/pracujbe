import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const locales = ['pl', 'nl', 'fr', 'en'] as const;

for (const locale of locales) {
  const { home } = JSON.parse(
    readFileSync(resolve('src/messages', `${locale}.json`), 'utf8'),
  ) as {
    home: {
      heroTitle: string;
      heroTitleLine1: string;
      heroTitleLine2: string;
      heroTitleLine3: string;
      heroBrowseJobs: string;
      heroCreateProfile: string;
      heroPhotoCaption: string;
      heroPhotoDisclaimer: string;
      searchButton: string;
    };
  };

  for (const width of [320, 1440]) {
    test(`home hero ${locale} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/${locale}`);

      const heading = page.getByRole('heading', { level: 1, name: home.heroTitle });
      await expect(heading).toBeVisible();
      for (const line of [home.heroTitleLine1, home.heroTitleLine2, home.heroTitleLine3]) {
        await expect(heading.locator('span', { hasText: line })).toBeVisible();
      }

      const jobsLink = page.getByRole('link', { name: home.heroBrowseJobs, exact: true });
      const profileLink = page.getByRole('link', { name: home.heroCreateProfile, exact: true });
      await expect(jobsLink).toHaveAttribute('href', `/${locale}/oferty-pracy`);
      await expect(profileLink).toHaveAttribute('href', `/${locale}/rejestracja`);

      const caption = page.locator('figure').filter({ has: page.locator('img[src*="team.webp"]') }).locator('figcaption');
      await expect(caption).toContainText(home.heroPhotoCaption);
      await expect(caption).toContainText(home.heroPhotoDisclaimer);
      await expect(page.getByRole('search').getByRole('button', { name: home.searchButton })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      await jobsLink.focus();
      await expect(jobsLink).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(profileLink).toBeFocused();
      await profileLink.click();
      await expect(page).toHaveURL(new RegExp(`/${locale}/rejestracja(?:\\?|$)`));
    });
  }
}

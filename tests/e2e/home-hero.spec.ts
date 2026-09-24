import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { LOCALES, messages, rejectOptionalCookies } from './fixtures/messages';

/**
 * #166 — hero strony głównej wg zatwierdzonego prototypu (`people.js`): trzywierszowa teza,
 * opis, czerwona akcja główna „Przeglądaj oferty” (token --primary), link do rejestracji
 * kandydata (bez obietnicy chronionego profilu) i fotografia z podpisem NA zdjęciu, oznaczona
 * jako ilustracyjna. Sprawdzane w 4 językach przy 320 i 1440 px + axe (critical/serious)
 * w obrębie hero. Kontrola ujemna na końcu psuje DOM i wymaga, by te same sprawdzenia padły.
 */

type HomeMessages = {
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

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const BLOCKING = new Set(['critical', 'serious']);
const HERO = 'section:has(h1)';

async function heroAxeViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).include(HERO).analyze();
  return results.violations
    .filter((v) => BLOCKING.has(v.impact ?? ''))
    .map((v) => `[${v.impact}] ${v.id}: ${v.nodes[0]?.target.join(' ')}`);
}

/**
 * Układ hero liczony w przeglądarce: brak poziomego scrolla, podpis leży na zdjęciu (w figurze,
 * zdjęcie widoczne nad nim), akcja główna ma tło z tokenu --primary.
 */
async function heroLayoutProblems(page: Page, browseJobs: string): Promise<string[]> {
  return page.evaluate(
    ({ hero, browseJobs }) => {
      const problems: string[] = [];
      if (document.documentElement.scrollWidth > window.innerWidth) problems.push('horizontal-overflow');

      const section = document.querySelector(hero);
      const img = section?.querySelector('img[src*="team.webp"]');
      const figure = img?.closest('figure');
      const caption = figure?.querySelector(':scope > figcaption');
      if (!figure || !caption) {
        problems.push('caption-not-on-photo');
      } else {
        const f = figure.getBoundingClientRect();
        const c = caption.getBoundingClientRect();
        const inside = c.top >= f.top && c.bottom <= f.bottom + 0.5 && c.left >= f.left && c.right <= f.right + 0.5;
        if (!inside) problems.push('caption-not-on-photo');
        if (c.top - f.top < 120) problems.push('photo-hidden-by-caption');
      }

      const cta = Array.from(section?.querySelectorAll('a') ?? []).find(
        (a) => a.textContent?.trim() === browseJobs,
      );
      const probe = document.createElement('span');
      probe.style.backgroundColor = 'hsl(var(--primary))';
      document.body.append(probe);
      const primary = getComputedStyle(probe).backgroundColor;
      probe.remove();
      if (!cta || getComputedStyle(cta).backgroundColor !== primary) problems.push('primary-cta-not-brand');
      return problems;
    },
    { hero: HERO, browseJobs },
  );
}

for (const locale of LOCALES) {
  const { home } = messages(locale) as unknown as HomeMessages;

  for (const width of [320, 1440]) {
    test(`home hero ${locale} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/${locale}`);
      await rejectOptionalCookies(page, locale);

      const heading = page.getByRole('heading', { level: 1, name: home.heroTitle });
      await expect(heading).toBeVisible();
      for (const line of [home.heroTitleLine1, home.heroTitleLine2, home.heroTitleLine3]) {
        await expect(heading.locator('span', { hasText: line })).toBeVisible();
      }

      const jobsLink = page.getByRole('link', { name: home.heroBrowseJobs, exact: true });
      const profileLink = page.getByRole('link', { name: home.heroCreateProfile, exact: true });
      await expect(jobsLink).toHaveAttribute('href', `/${locale}/oferty-pracy`);
      await expect(profileLink).toHaveAttribute('href', `/${locale}/rejestracja`);

      const figure = page.locator(HERO).locator('figure').filter({ has: page.locator('img[src*="team.webp"]') });
      await expect(figure.locator('img')).toHaveAttribute('alt', '');
      const caption = figure.locator('figcaption');
      await expect(caption).toContainText(home.heroPhotoCaption);
      await expect(caption).toContainText(home.heroPhotoDisclaimer);
      await expect(page.getByRole('search').getByRole('button', { name: home.searchButton })).toBeVisible();

      expect(await heroLayoutProblems(page, home.heroBrowseJobs)).toEqual([]);
      expect(await heroAxeViolations(page)).toEqual([]);

      await jobsLink.focus();
      await expect(jobsLink).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(profileLink).toBeFocused();
      await profileLink.click();
      await expect(page).toHaveURL(new RegExp(`/${locale}/rejestracja(?:\\?|$)`));
    });
  }
}

test('kontrola ujemna: zepsuty hero jest wykrywany przez sprawdzenia układu i axe', async ({ page }) => {
  const { home } = messages('pl') as unknown as HomeMessages;
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto('/pl');
  await rejectOptionalCookies(page, 'pl');
  expect(await heroLayoutProblems(page, home.heroBrowseJobs)).toEqual([]);

  await page.evaluate(
    ({ hero, browseJobs }) => {
      const section = document.querySelector(hero)!;
      const figure = section.querySelector('figure')!;
      // Podpis poza zdjęciem (dawny układ z paskiem pod fotografią).
      figure.after(figure.querySelector('figcaption')!);
      // Element szerszy niż ekran.
      const wide = document.createElement('div');
      wide.style.width = '480px';
      wide.style.height = '1px';
      section.append(wide);
      // Czarna akcja zamiast czerwonej, z tekstem prawie w kolorze tła (kontrast < 4.5:1).
      const cta = Array.from(section.querySelectorAll('a')).find((a) => a.textContent?.trim() === browseJobs)!;
      cta.style.transition = 'none'; // bez tego odczyt trafia w start animacji transition-colors
      cta.style.backgroundColor = 'hsl(var(--foreground))';
      cta.style.color = 'hsl(0 0% 20%)';
    },
    { hero: HERO, browseJobs: home.heroBrowseJobs },
  );

  expect(await heroLayoutProblems(page, home.heroBrowseJobs)).toEqual(
    expect.arrayContaining(['horizontal-overflow', 'caption-not-on-photo', 'primary-cta-not-brand']),
  );
  expect((await heroAxeViolations(page)).some((v) => v.includes('color-contrast'))).toBe(true);
});

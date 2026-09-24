import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { rejectOptionalCookies } from './fixtures/messages';

/**
 * Pulpit kandydata w trybie demo (bez imienia, z propozycją i rozmowami):
 * #334 powitanie bez wiszącego przecinka, #324 baner prowadzi do karty propozycji,
 * #340 najnowsze wiadomości otwierają wątek, #338 tekst 200% bez poziomego przewijania.
 */
const locales = ['pl', 'nl', 'fr', 'en'] as const;

type Messages = {
  dashboard: { greetingNoName: string; viewProposal: string; latestMessages: string };
  messages: { unreadBadge: string };
};

function messages(locale: string): Messages {
  return JSON.parse(readFileSync(resolve('src/messages', `${locale}.json`), 'utf8')) as Messages;
}


async function horizontalOverflow(page: Page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const outside = Array.from(document.querySelectorAll<HTMLElement>('main button, main a, main p, main h1, main h2'))
      .filter((el) => el.getClientRects().length > 0)
      .map((el) => ({ text: el.textContent?.trim().slice(0, 40), right: el.getBoundingClientRect().right }))
      .filter((el) => el.right > root.clientWidth + 1);
    return { clientWidth: root.clientWidth, scrollWidth: root.scrollWidth, outside };
  });
}

for (const locale of locales) {
  test(`pulpit bez imienia wita neutralnie, bez przecinka: ${locale}`, async ({ page }) => {
    const m = messages(locale);
    await page.goto(`/${locale}/candidate`);
    const h1 = page.getByRole('main').getByRole('heading', { level: 1 });
    await expect(h1).toHaveText(m.dashboard.greetingNoName);
    await expect(h1).not.toHaveText(/,\s*$/);
  });

  test(`baner propozycji prowadzi do karty propozycji: ${locale}`, async ({ page }) => {
    const m = messages(locale);
    await page.goto(`/${locale}/candidate`);
    await rejectOptionalCookies(page, locale);
    const link = page.getByRole('link', { name: m.dashboard.viewProposal });
    const href = await link.getAttribute('href');
    expect(href).toMatch(new RegExp(`^/${locale}/candidate/propozycje#offer-.+`));

    await link.click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/candidate/propozycje#offer-`));
    const anchor = decodeURIComponent(href!.split('#')[1]!);
    await expect(page.locator(`[id="${anchor}"]`)).toBeVisible();
  });

  test(`najnowsze wiadomości otwierają rozmowę: ${locale}`, async ({ page }) => {
    const m = messages(locale);
    await page.goto(`/${locale}/candidate`);
    await rejectOptionalCookies(page, locale);
    const section = page.locator('section').filter({ has: page.getByRole('heading', { name: m.dashboard.latestMessages }) });
    const links = section.getByRole('link').filter({ has: page.locator('[aria-hidden="true"]') });
    await expect(links.first()).toHaveAttribute('href', new RegExp(`^/${locale}/candidate/wiadomosci\\?c=`));
    await expect(section.getByText(m.messages.unreadBadge, { exact: true }).first()).toBeAttached();

    const box = await links.first().boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

    const href = await links.first().getAttribute('href');
    await links.first().click();
    await expect(page).toHaveURL(new RegExp(`\\?c=${href!.split('?c=')[1]}`));
  });

  for (const path of ['candidate', 'candidate/propozycje']) {
    test(`tekst 200% bez poziomego przewijania: /${locale}/${path} @ 1280px`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`/${locale}/${path}`);
      await rejectOptionalCookies(page, locale);
      await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
      const report = await horizontalOverflow(page);
      expect(report.outside, JSON.stringify(report)).toEqual([]);
      expect(report.scrollWidth, JSON.stringify(report)).toBeLessThanOrEqual(report.clientWidth + 1);
    });
  }
}

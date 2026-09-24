import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

import { LOCALES, rejectOptionalCookies, type TestLocale } from './fixtures/messages';

/**
 * #339 — „Dla pracodawców” otwiera indeksowalną stronę informacyjną w bieżącym języku
 * (h1, canonical, hreflang, bez noindex), a jej CTA prowadzi do formularza konta pracodawcy.
 */

type Messages = {
  nav: { menu: string; forEmployers: string };
  footer: { forEmployers: string; howItWorks: string };
  employers: { title: string; ctaRegister: string; metaTitle: string };
  auth: { registerEmployerTitle: string };
};

function m(locale: TestLocale): Messages {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), 'src', 'messages', `${locale}.json`), 'utf8'),
  ) as Messages;
}

for (const locale of LOCALES) {
  test(`nawigacja → strona dla pracodawców → rejestracja (${locale})`, async ({ page }) => {
    const t = m(locale);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/${locale}`);
    await rejectOptionalCookies(page, locale);

    const nav = page.getByRole('banner').getByRole('navigation', { name: t.nav.menu });
    await nav.getByRole('link', { name: t.nav.forEmployers, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/dla-pracodawcow$`));
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await expect(page.getByRole('heading', { level: 1, name: t.employers.title })).toBeVisible();
    await expect(page).toHaveTitle(t.employers.metaTitle);
    await expect(nav.getByRole('link', { name: t.nav.forEmployers, exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );

    // Indeksowalna: brak noindex, własny canonical i komplet hreflang.
    await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(0);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      new RegExp(`/${locale}/dla-pracodawcow$`),
    );
    for (const lang of [...LOCALES, 'x-default']) {
      await expect(page.locator(`link[rel="alternate"][hreflang="${lang}"]`)).toHaveAttribute(
        'href',
        new RegExp(`/${lang === 'x-default' ? 'pl' : lang}/dla-pracodawcow$`),
      );
    }

    // Stopka: kolumna „Dla pracodawców” linkuje do strony informacyjnej.
    const footerNav = page.getByRole('contentinfo').getByRole('navigation', { name: t.footer.forEmployers });
    await expect(footerNav.getByRole('link', { name: t.footer.howItWorks })).toHaveAttribute(
      'href',
      `/${locale}/dla-pracodawcow`,
    );

    // Oba CTA (nagłówek i koniec strony) prowadzą do formularza konta pracodawcy.
    const ctas = page.getByRole('main').getByRole('link', { name: t.employers.ctaRegister });
    await expect(ctas).toHaveCount(2);
    for (const href of await ctas.evaluateAll((els) => els.map((el) => el.getAttribute('href')))) {
      expect(href).toBe(`/${locale}/rejestracja-pracodawca`);
    }
    await page.getByRole('main').getByRole('link', { name: t.employers.ctaRegister }).last().click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/rejestracja-pracodawca$`));
    await expect(page.getByText(t.auth.registerEmployerTitle, { exact: true }).first()).toBeVisible();
  });
}

test('strona dla pracodawców mieści się przy 320 px bez przewijania w poziomie', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  for (const locale of LOCALES) {
    await page.goto(`/${locale}/dla-pracodawcow`);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, locale).toBeLessThanOrEqual(0);
  }
});

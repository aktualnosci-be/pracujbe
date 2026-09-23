import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type BrowserContext } from '@playwright/test';

/**
 * Wejścia dla pracodawców na stronie głównej (#201). Każdy link „dodaj ofertę” / „dla
 * pracodawców” widoczny na home musi prowadzić do istniejącej strony (200, nie 404),
 * a CTA z treści strony (hero i karta „Jesteś pracodawcą?”) — do formularza konta
 * pracodawcy w bieżącym języku.
 */

const locales = ['pl', 'nl', 'fr', 'en'] as const;
type Locale = (typeof locales)[number];

type Messages = {
  nav: { postJob: string; forEmployers: string };
  footer: { postJob: string; forEmployers: string };
  home: { ctaPostJob: string; companiesCta: string };
  auth: { registerEmployerTitle: string; companyName: string };
};

function messages(locale: Locale): Messages {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), 'src', 'messages', `${locale}.json`), 'utf8'),
  ) as Messages;
}

async function setNecessaryConsent(context: BrowserContext, baseURL: string): Promise<void> {
  await context.addCookies([
    {
      name: 'pracujbe_consent',
      value: JSON.stringify({
        v: process.env.NEXT_PUBLIC_CONSENT_POLICY_VERSION ?? '1.0',
        categories: { necessary: true, preferences: false, analytics: false, marketing: false },
        ts: '2026-01-01T00:00:00.000Z',
        id: 'employer-entry-e2e',
      }),
      url: baseURL,
      sameSite: 'Lax',
    },
  ]);
}

for (const locale of locales) {
  const m = messages(locale);
  const labels = [
    m.nav.postJob,
    m.nav.forEmployers,
    m.footer.postJob,
    m.footer.forEmployers,
    m.home.ctaPostJob,
    m.home.companiesCta,
  ];

  test(`employer links on home resolve (${locale})`, async ({ page, request }) => {
    await page.goto(`/${locale}`);

    const hrefs = await page.locator('a[href]').evaluateAll(
      (anchors, names) =>
        anchors
          .filter((a) => {
            const text = (a.textContent ?? '').replace(/\s+/g, ' ').trim();
            return names.some((name) => text.includes(name));
          })
          .map((a) => a.getAttribute('href') ?? ''),
      labels,
    );
    const unique = [...new Set(hrefs)];

    // Hero, karta firm, nagłówek i stopka — co najmniej jedno wejście musi istnieć.
    expect(unique.length).toBeGreaterThan(0);
    for (const href of unique) {
      const response = await request.get(href, { maxRedirects: 0 });
      expect(response.status(), `${href} (${locale})`).toBe(200);
    }
  });

  for (const cta of new Set([m.home.ctaPostJob, m.home.companiesCta])) {
    test(`home CTA "${cta}" opens employer sign-up (${locale})`, async ({ page, context, baseURL }) => {
      await setNecessaryConsent(context, baseURL ?? 'http://localhost:3000');
      await page.goto(`/${locale}`);

      const main = page.locator('main');
      const links = main.getByRole('link', { name: cta });
      // Hero (kafelek pod wyszukiwarką) i karta „Jesteś pracodawcą?” — sprawdzamy każdy link.
      const count = await links.count();
      expect(count).toBeGreaterThanOrEqual(2);

      for (let i = 0; i < count; i += 1) {
        await page.goto(`/${locale}`);
        const link = main.getByRole('link', { name: cta }).nth(i);
        await link.scrollIntoViewIfNeeded();
        await link.click();
        await expect(page).toHaveURL(new RegExp(`/${locale}/[^/?#]+$`));
        await expect(page.getByText(m.auth.registerEmployerTitle, { exact: true }).first()).toBeVisible();
        await expect(page.getByLabel(m.auth.companyName)).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('lang', locale);
      }
    });
  }
}

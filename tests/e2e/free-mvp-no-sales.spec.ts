import { expect, test, type Page } from '@playwright/test';

import { LOCALES, messages, rejectOptionalCookies } from './fixtures/messages';

/**
 * #51 — bezpłatny MVP: w żadnym języku użytkownik nie widzi cennika, pakietów ani CTA zakupu,
 * a trasy sprzedażowe są nieosiągalne (flaga `BILLING_ENABLED` domyślnie wyłączona).
 *
 * Zakazane teksty pochodzą z plików tłumaczeń (dawne klucze sprzedaży, które zostały w
 * `src/messages` bez użycia) oraz z ogólnych słów sprzedażowych w danym języku.
 */

type SalesCopy = {
  employers: { freeDesc: string };
  footer: { pricing: string };
  billing: { plansTitle: string; choosePlan: string };
  dashboard: { yourPackage: string; changePackage: string; navPayments: string };
  pricing: { popular: string };
};

// Słowa pakiet/subskrypcja celowo poza listą: strona dla pracodawców mówi wprost, że portal
// ich NIE sprzedaje (`employers.freeDesc`) — ten tekst jest wymagany, nie zakazany.
const SALES_WORDS: Record<(typeof LOCALES)[number], RegExp> = {
  pl: /\b(cennik\w*|premium|kup teraz|kup pakiet|wybierz pakiet|zmień pakiet)\b/i,
  nl: /\b(tarieven|premium|nu kopen|kies pakket|pakket wijzigen)\b/i,
  fr: /\b(tarifs|premium|acheter|choisir le forfait|changer de forfait)\b/i,
  en: /\b(pricing|premium|buy now|upgrade|choose plan|change plan)\b/i,
};

const PUBLIC_PATHS = ['', '/oferty-pracy', '/praca', '/dla-pracodawcow', '/rejestracja-pracodawca'];
const EMPLOYER_PATHS = ['/employer', '/employer/oferty', '/employer/firma', '/employer/ustawienia'];

async function expectNoSalesSurface(page: Page, locale: (typeof LOCALES)[number]): Promise<void> {
  const t = messages(locale) as unknown as SalesCopy;
  const exact = [
    t.footer.pricing,
    t.billing.plansTitle,
    t.billing.choosePlan,
    t.dashboard.yourPackage,
    t.dashboard.changePackage,
    t.dashboard.navPayments,
    t.pricing.popular,
  ];
  const body = page.locator('body');
  for (const text of exact) {
    await expect(page.getByText(text, { exact: true }), `${page.url()}: „${text}”`).toHaveCount(0);
  }
  await expect(body).not.toContainText(SALES_WORDS[locale]);
  // Żaden link nie prowadzi do cennika, płatności ani checkoutu.
  await expect(
    page.locator('a[href*="cennik"], a[href*="pricing"], a[href*="platnosci"], a[href*="checkout"], a[href*="stripe"]'),
  ).toHaveCount(0);
}

for (const locale of LOCALES) {
  test(`brak cennika i CTA zakupu na stronach publicznych (${locale})`, async ({ page }) => {
    await page.goto(`/${locale}`);
    await rejectOptionalCookies(page, locale);
    for (const path of PUBLIC_PATHS) {
      await page.goto(`/${locale}${path}`);
      await expectNoSalesSurface(page, locale);
    }

    // Pozytywnie: strona dla pracodawców mówi o bezpłatnym dostępie.
    await page.goto(`/${locale}/dla-pracodawcow`);
    const t = messages(locale) as unknown as SalesCopy;
    await expect(page.getByText(t.employers.freeDesc, { exact: true })).toBeVisible();
  });

  test(`brak płatności i pakietu w panelu pracodawcy (${locale})`, async ({ page }) => {
    await page.goto(`/${locale}/employer`);
    await rejectOptionalCookies(page, locale);
    for (const path of EMPLOYER_PATHS) {
      await page.goto(`/${locale}${path}`);
      await expectNoSalesSurface(page, locale);
    }
  });

  test(`trasy sprzedażowe są niedostępne (${locale})`, async ({ page, request }) => {
    for (const path of ['/cennik', '/pricing', '/tarifs', '/tarieven']) {
      const response = await request.get(`/${locale}${path}`);
      expect(response.status(), `/${locale}${path}`).toBe(404);
    }

    // Dawny adres panelu płatności przekierowuje na pulpit pracodawcy.
    await page.goto(`/${locale}/employer/platnosci`);
    await expect(page).toHaveURL(new RegExp(`/${locale}/employer$`));
  });
}

test('webhook Stripe nie istnieje przy wyłączonej fladze', async ({ request }) => {
  const response = await request.post('/api/stripe/webhook', {
    data: { id: 'evt_test', type: 'checkout.session.completed' },
    headers: { 'stripe-signature': 't=1,v1=deadbeef' },
  });
  expect(response.status()).toBe(404);
});

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { cookieBanner, LOCALES, rejectOptionalCookies } from './fixtures/messages';

/**
 * #221 — bramka axe (WCAG 2.x A/AA, blokada critical/serious jak w a11y.spec.ts) na WSZYSTKICH
 * trasach publicznych, w 4 językach, przy 1280 i 320 px, w dwóch stanach: z widocznym banerem
 * cookies i po jego zamknięciu („Tylko niezbędne”).
 *
 * Koszt (pula minut Actions, CLAUDE.md §10): jedna nawigacja na trasę × język. Przy widocznym
 * banerze axe sprawdza sam baner (jego treść i kontrolki nakładają się na każdą stronę), po
 * zamknięciu — całą stronę; pełny audyt strony z banerem na kluczowych trasach robi już
 * a11y.spec.ts. Szerokość zależy od języka: PL i FR przy 1280 px, NL i EN przy 320 px — każda
 * trasa jest więc sprawdzana w obu szerokościach i w każdym języku.
 */

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const BLOCKING = new Set(['critical', 'serious']);
const BANNER = '[aria-labelledby="cookie-banner-title"]';
const WIDTH: Record<(typeof LOCALES)[number], number> = { pl: 1280, fr: 1280, nl: 320, en: 320 };

const ROUTES = [
  '',
  '/oferty-pracy',
  '/oferty-pracy/bricklayer-brussels-1002',
  '/praca',
  '/praca/kategoria',
  '/praca/kategoria/construction',
  '/praca/miasto',
  '/praca/miasto/brussels',
  '/poradniki',
  '/poradniki/praca-w-belgii-bez-znajomosci-jezyka',
  '/dla-pracodawcow',
  '/o-nas',
  '/faq',
  '/kontakt',
  '/pomoc',
  '/regulamin',
  '/polityka-prywatnosci',
  '/polityka-cookies',
  '/logowanie',
  '/rejestracja',
  '/rejestracja-pracodawca',
  '/reset-hasla',
  '/ustaw-nowe-haslo',
  '/potwierdz-email',
  '/offline',
  '/nie-istnieje',
];

async function blockingViolations(page: Page, include?: string): Promise<string[]> {
  const builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
  if (include) builder.include(include);
  const results = await builder.analyze();
  return results.violations
    .filter((v) => BLOCKING.has(v.impact ?? ''))
    .map((v) => `[${v.impact}] ${v.id} (${v.nodes.length}×): ${v.nodes[0]?.target.join(' ')}`);
}

for (const locale of LOCALES) {
  test.describe(`a11y tras publicznych (${locale}, ${WIDTH[locale]} px)`, () => {
    test.use({ viewport: { width: WIDTH[locale], height: 800 } });

    // Jeden test na język (jedna karta przeglądarki na wszystkie trasy — mniej minut CI);
    // `expect.soft` zbiera naruszenia ze wszystkich tras zamiast kończyć na pierwszej.
    test(`/${locale}/*: brak critical/serious z banerem i po jego zamknięciu`, async ({ page, context }) => {
      test.setTimeout(ROUTES.length * 15_000);
      for (const route of ROUTES) {
        const url = `/${locale}${route}`;
        await test.step(url, async () => {
          await context.clearCookies();
          await page.goto(url);
          await page.getByRole('main').first().waitFor();
          // Baner montuje się po hydratacji — jego widoczność to sygnał gotowości strony
          // (zamiast stałego odczekania, #375).
          await expect(cookieBanner(page)).toBeVisible();
          expect.soft(await blockingViolations(page, BANNER), `${url}: baner cookies`).toEqual([]);

          await rejectOptionalCookies(page, locale);
          expect.soft(await blockingViolations(page), `${url} po zamknięciu banera`).toEqual([]);
        });
      }
    });
  });
}

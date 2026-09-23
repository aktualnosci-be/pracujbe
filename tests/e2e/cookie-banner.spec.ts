import { expect, test, type Page } from '@playwright/test';

/**
 * Baner cookies a dostępność (#203, #206).
 *
 * Testy działają na świeżym kontekście przeglądarki — bez zapisanej zgody baner jest widoczny.
 * - 2.4.11: element z fokusem nie może leżeć w całości pod banerem (fixed, dół ekranu).
 * - 2.4.3: przyciski banera są na początku kolejności Tab, a nie za całą stopką.
 * - 1.4.4 / 1.4.10: przy tekście 200% baner mieści się w viewporcie, a jego przyciski nie
 *   wychodzą poza ekran.
 */

const LOCALES = ['pl', 'nl', 'fr', 'en'] as const;
const BANNER = '[aria-labelledby="cookie-banner-title"]';

type Stop = { label: string; inBanner: boolean; top: number; bottom: number; bannerTop: number };

async function focusStop(page: Page): Promise<Stop | null> {
  return page.evaluate((selector) => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    const banner = document.querySelector(selector);
    const rect = el.getBoundingClientRect();
    return {
      label: (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 40),
      inBanner: !!banner?.contains(el),
      top: rect.top,
      bottom: rect.bottom,
      bannerTop: banner ? banner.getBoundingClientRect().top : Number.POSITIVE_INFINITY,
    };
  }, BANNER);
}

/** Przechodzi Tabem przez stronę i zwraca zatrzymania fokusu (do powtórzenia pierwszego). */
async function tabThrough(page: Page, max = 120): Promise<Stop[]> {
  const stops: Stop[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press('Tab');
    const stop = await focusStop(page);
    if (!stop) break;
    const key = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      el.dataset.tabSeen = el.dataset.tabSeen ?? String(Math.random());
      return el.dataset.tabSeen;
    });
    if (seen.has(key)) break;
    seen.add(key);
    stops.push(stop);
  }
  return stops;
}

async function openFresh(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator(BANNER)).toBeVisible();
}

const FOCUS_CASES: Array<{ width: number; path: string }> = [
  { width: 320, path: '/pl/oferty-pracy' },
  { width: 320, path: '/fr/praca' },
  { width: 320, path: '/pl/regulamin' },
  { width: 320, path: '/pl/rejestracja' },
  { width: 320, path: '/nl/logowanie' },
  { width: 1280, path: '/fr/praca' },
  { width: 1280, path: '/pl/regulamin' },
  { width: 1280, path: '/en/poradniki' },
  { width: 1280, path: '/pl/rejestracja' },
];

for (const { width, path } of FOCUS_CASES) {
  test(`fokus nie znika pod banerem cookies: ${path} (${width} px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await openFresh(page, path);

    const stops = await tabThrough(page);
    expect(stops.length).toBeGreaterThan(3);
    const hidden = stops.filter((s) => !s.inBanner && s.top >= s.bannerTop);
    expect(
      hidden.map((s) => s.label),
      'elementy z fokusem w całości pod banerem',
    ).toEqual([]);
  });
}

for (const locale of LOCALES) {
  test(`przyciski banera są na początku kolejności Tab (${locale})`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await openFresh(page, `/${locale}/oferty-pracy`);

    let firstBannerButton = -1;
    for (let i = 1; i <= 5; i += 1) {
      await page.keyboard.press('Tab');
      const isBannerButton = await page.evaluate(
        (selector) =>
          document.activeElement?.tagName === 'BUTTON' &&
          !!document.querySelector(selector)?.contains(document.activeElement),
        BANNER,
      );
      if (isBannerButton) {
        firstBannerButton = i;
        break;
      }
    }
    expect(firstBannerButton, 'pierwszy przycisk banera w ≤ 5 Tabach').toBeGreaterThan(0);
  });
}

test('przycisk formularza na krótkiej stronie da się przewinąć ponad baner (320×568)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await openFresh(page, '/pl/rejestracja-pracodawca');

  const submit = page.locator('form button[type="submit"]').first();
  for (
    let i = 0;
    i < 40 && !(await submit.evaluate((el) => el === document.activeElement));
    i += 1
  ) {
    await page.keyboard.press('Tab');
  }
  await expect(submit).toBeFocused();
  const hitsItself = await submit.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return !!hit && el.contains(hit);
  });
  expect(hitsItself, 'środek przycisku nie jest zasłonięty przez baner').toBe(true);
});

test('po zamknięciu banera strona nie zostawia dodatkowego odstępu', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await openFresh(page, '/pl/oferty-pracy');
  expect(
    await page.evaluate(() => parseFloat(getComputedStyle(document.body).paddingBottom)),
  ).toBeGreaterThan(0);

  await page.locator(`${BANNER} button`).first().click();
  await expect(page.locator(BANNER)).toHaveCount(0);
  expect(
    await page.evaluate(() => ({
      padding: parseFloat(getComputedStyle(document.body).paddingBottom),
      scrollPadding: getComputedStyle(document.documentElement).scrollPaddingBottom,
    })),
  ).toEqual({ padding: 0, scrollPadding: '0px' });
});

for (const locale of LOCALES) {
  // 320 px = reflow (1.4.10): bez limitu wysokości baner byłby wyższy niż ekran, a przyciski
  // bez zawijania ucinałyby tekst (nl/fr).
  for (const width of [320, 640, 1024]) {
    test(`baner mieści się w ekranie przy tekście 200% (${locale}, ${width} px)`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await openFresh(page, `/${locale}`);
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '200%';
      });

      const banner = page.locator(BANNER);
      const layout = await banner.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        const title = document.getElementById('cookie-banner-title')!.getBoundingClientRect();
        return {
          top: rect.top,
          bottom: rect.bottom,
          titleTop: title.top,
          buttons: [...el.querySelectorAll('button')].map((b) => {
            const r = b.getBoundingClientRect();
            return { left: r.left, right: r.right, clipped: b.scrollWidth > b.clientWidth + 1 };
          }),
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
        };
      });
      expect(layout.top).toBeGreaterThanOrEqual(0);
      expect(layout.bottom).toBeLessThanOrEqual(layout.innerHeight + 1);
      expect(layout.titleTop).toBeGreaterThanOrEqual(0);
      expect(layout.buttons).toHaveLength(3);
      for (const b of layout.buttons) {
        expect(b.left).toBeGreaterThanOrEqual(0);
        expect(b.right).toBeLessThanOrEqual(layout.innerWidth);
        expect(b.clipped, 'tekst przycisku zawija się zamiast wystawać').toBe(false);
      }
      // Każdy przycisk jest osiągalny: po przewinięciu kontenera banera trafia w widok.
      for (const button of await banner.locator('button').all()) {
        await button.scrollIntoViewIfNeeded();
        await expect(button).toBeInViewport();
      }
    });
  }
}

test('baner zostaje widoczny i na początku Tab po nawigacji do innego układu', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await openFresh(page, '/pl');
  await page.locator('header').getByRole('link', { name: 'Zaloguj się' }).click();
  await expect(page).toHaveURL(/\/pl\/logowanie$/);
  await expect(page.locator(BANNER)).toBeVisible();

  await page.locator('body').focus();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  let reached = false;
  for (let i = 0; i < 4 && !reached; i += 1) {
    await page.keyboard.press('Tab');
    reached = await page.evaluate(
      (selector) => !!document.querySelector(selector)?.contains(document.activeElement),
      BANNER,
    );
  }
  expect(reached, 'baner osiągalny na początku kolejności Tab').toBe(true);
  expect(errors.filter((e) => /hydrat/i.test(e))).toEqual([]);
});

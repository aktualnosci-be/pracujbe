import { expect, test, type Page } from '@playwright/test';

/**
 * #318 — kafelki statystyk i lejek przy tekście 200% (WCAG 1.4.4) w panelach pracodawcy
 * i admina (tryb DEMO). Viewport 1280 px, `html { font-size: 200% }` — siatka ma przejść do
 * mniejszej liczby kolumn zamiast wypychać treść poza ekran. Bez asercji na piksele układu:
 * sprawdzamy tylko brak poziomego przewijania i brak elementów wystających poza viewport.
 */

const ROUTES = ['/employer', '/employer/statystyki', '/admin'] as const;

async function acceptNecessaryCookies(page: Page): Promise<void> {
  await page.context().addCookies([
    {
      name: 'pracujbe_consent',
      value: JSON.stringify({
        v: process.env.NEXT_PUBLIC_CONSENT_POLICY_VERSION ?? '1.0',
        categories: { necessary: true, preferences: false, analytics: false, marketing: false },
        ts: '2026-01-01T00:00:00.000Z',
        id: 'panel-stats-text-zoom-e2e',
      }),
      url: 'http://localhost:3000',
      sameSite: 'Lax',
    },
  ]);
}

async function overflow(page: Page) {
  return page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const offenders = [...document.querySelectorAll<HTMLElement>('main *')]
      .filter((el) => {
        const b = el.getBoundingClientRect();
        return b.width > 0 && b.height > 0 && (b.left < -1 || b.right > viewportWidth + 1);
      })
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 80)}`);
    // Tekst potrafi wystawać poza własne pudełko (długie słowo bez zawijania) — sprawdzamy też
    // węzły tekstowe, a nie tylko prostokąty elementów.
    const walker = document.createTreeWalker(document.querySelector('main') ?? document.body, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let node = walker.nextNode(); node && offenders.length < 5; node = walker.nextNode()) {
      range.selectNodeContents(node);
      const b = range.getBoundingClientRect();
      if (b.width > 0 && (b.left < -1 || b.right > viewportWidth + 1)) {
        offenders.push(`text:${(node.textContent ?? '').slice(0, 40)}`);
      }
    }
    return { scrollWidth: document.documentElement.scrollWidth, viewportWidth, offenders };
  });
}

for (const locale of ['pl', 'fr'] as const) {
  for (const route of ROUTES) {
    test(`200% tekstu bez poziomego scrolla: /${locale}${route}`, async ({ page }) => {
      await acceptNecessaryCookies(page);
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`/${locale}${route}`);
      await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();
      await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });

      const report = await overflow(page);
      const evidence = JSON.stringify(report, null, 2);
      expect(report.scrollWidth, evidence).toBeLessThanOrEqual(report.viewportWidth + 1);
      expect(report.offenders, evidence).toEqual([]);
    });
  }
}

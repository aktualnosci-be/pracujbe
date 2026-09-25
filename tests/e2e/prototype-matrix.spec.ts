import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

import { LOCALES, messages, rejectOptionalCookies } from './fixtures/messages';

/**
 * Zadania Z1–Z6 z `docs/design/people-passport/MATRIX.md` (#5/#6/#7) — style kluczowych
 * elementów porównane z wartościami prototypu `docs/design/people-passport/prototype`
 * (`getComputedStyle`, jak `scripts/design/compare-prototype.mjs`, tolerancja 1 px).
 *
 * - Z5: strona 404 = `.p-list-header` (nadtytuł 12 px/700 wersaliki, H1 40/32 px, 700,
 *   −0,035em) + `.people .btn` (14 px/650, promień 11 px, min. 49 px) i `.btn.secondary`.
 * - Z6: filtry list admina i przyciski akcji w wierszu = `.btn`/`.btn.secondary` (bez pigułek).
 *
 * Kontrola ujemna: te same asercje na wstrzykniętej pigułce (dawny `rounded-full`, 44 px)
 * muszą zwrócić rozbieżności — inaczej test niczego by nie pilnował.
 */

type Expected = Partial<Record<'fontSize' | 'fontWeight' | 'letterSpacing' | 'borderRadius' | 'minHeight' | 'textTransform', string>>;

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** `.people .btn` — geometria przycisku prototypu. */
const BTN: Expected = { fontSize: '14px', fontWeight: '650', borderRadius: '11px', minHeight: '49px' };

async function styleMismatches(locator: Locator, expected: Expected): Promise<string[]> {
  const actual = await locator.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      fontSize: s.fontSize,
      fontWeight: s.fontWeight,
      letterSpacing: s.letterSpacing,
      borderRadius: s.borderTopLeftRadius,
      minHeight: s.minHeight,
      textTransform: s.textTransform,
    };
  });
  const out: string[] = [];
  for (const [prop, want] of Object.entries(expected) as [keyof Expected, string][]) {
    const got = actual[prop];
    const a = parseFloat(got);
    const b = parseFloat(want);
    const same = Number.isFinite(a) && Number.isFinite(b) ? Math.abs(a - b) <= 1 : got === want;
    if (!same) out.push(`${prop}: ${want} → ${got}`);
  }
  return out;
}

async function expectStyle(locator: Locator, expected: Expected, label: string): Promise<void> {
  await expect(locator, label).toBeVisible();
  expect(await styleMismatches(locator, expected), label).toEqual([]);
}

async function blockingViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return results.violations
    .filter((v) => v.impact === 'critical' || v.impact === 'serious')
    .map((v) => `[${v.impact}] ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
}

type AllMessages = {
  errors: { notFound: string };
  nav: { jobs: string };
  common: { home: string };
  admin: Record<string, string>;
};

function t(locale: string): AllMessages {
  return messages(locale) as unknown as AllMessages;
}

for (const locale of LOCALES) {
  for (const width of [1280, 390] as const) {
    test(`Z5: 404 = .p-list-header + .btn (${locale}, ${width} px)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/${locale}/nie-ma-takiej-strony-z5`);
      await rejectOptionalCookies(page, locale);
      const m = t(locale);
      const main = page.locator('main');

      await expectStyle(main.getByText('404', { exact: true }), {
        fontSize: '12px',
        fontWeight: '700',
        textTransform: 'uppercase',
      }, 'nadtytuł');
      await expectStyle(page.getByRole('heading', { level: 1, name: m.errors.notFound }), {
        fontSize: width === 1280 ? '40px' : '32px',
        fontWeight: '700',
        letterSpacing: width === 1280 ? '-1.4px' : '-1.12px',
      }, 'H1');
      await expectStyle(main.getByRole('link', { name: m.nav.jobs, exact: true }), BTN, '.btn');
      await expectStyle(main.getByRole('link', { name: m.common.home, exact: true }), BTN, '.btn.secondary');
      expect(await blockingViolations(page)).toEqual([]);
    });
  }
}

for (const locale of ['pl', 'en'] as const) {
  test(`Z6: filtry i akcje admina = .btn prototypu (${locale})`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const a = t(locale).admin;

    await page.goto(`/${locale}/admin/poczta`);
    await rejectOptionalCookies(page, locale);
    const mailFilters = page.getByRole('navigation', { name: a.emailFilterLabel });
    const mailLinks = mailFilters.getByRole('link');
    expect(await mailLinks.count()).toBeGreaterThan(1);
    for (const link of await mailLinks.all()) await expectStyle(link, BTN, 'filtr poczty');
    await expect(mailFilters.locator('[aria-current="true"]')).toHaveCount(1);

    await page.goto(`/${locale}/admin/zgloszenia`);
    const reportFilters = page.getByRole('navigation', { name: a.filterReportsLabel });
    for (const link of await reportFilters.getByRole('link').all()) await expectStyle(link, BTN, 'filtr zgłoszeń');

    await page.goto(`/${locale}/admin/firmy`);
    const actions = page.locator('main table button');
    expect(await actions.count()).toBeGreaterThan(0);
    for (const button of await actions.all()) await expectStyle(button, BTN, 'akcja w wierszu');
    expect(await blockingViolations(page)).toEqual([]);

    // Szczegół firmy = podstrona: `.people .extended h1` (40 px, 750).
    await page.goto(`/${locale}/admin/firmy/demo-c2`);
    await expectStyle(page.locator('main h1'), { fontSize: '40px', fontWeight: '750' }, 'H1 szczegółu');
  });
}

test('kontrola ujemna: pigułka (rounded-full, 44 px, 500) nie przechodzi asercji .btn', async ({ page }) => {
  await page.goto('/pl/nie-ma-takiej-strony-z5');
  // Po hydratacji — inaczej React usuwa dopisany węzeł z drzewa `main`.
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => {
    const pill = document.createElement('a');
    pill.href = '#';
    pill.id = 'pill-control';
    pill.textContent = 'pill';
    pill.className = 'inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium';
    document.body.append(pill);
  });
  const mismatches = await styleMismatches(page.locator('#pill-control'), BTN);
  expect(mismatches).toEqual(
    expect.arrayContaining([
      expect.stringMatching(/^borderRadius/),
      expect.stringMatching(/^minHeight/),
      expect.stringMatching(/^fontWeight/),
    ]),
  );
});

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { cookieBanner, LOCALES } from './fixtures/messages';

/**
 * #373: bramka axe-core WCAG 2.x A/AA (critical/serious + `target-size`) na WSZYSTKICH trasach
 * paneli kandydata i pracodawcy osiągalnych w trybie demo (bez Supabase), w 4 językach.
 *
 * Podział kosztu (pula minut Actions, CLAUDE.md §10):
 * - 1280 px: każda trasa w PL i EN;
 * - 320 px: każda trasa w PL/NL/FR/EN, z wyjątkiem pięciu tras, które przy 320 px w 4 językach
 *   sprawdza już `passport-panel-a11y.spec.ts` (pulpity, profil, firma, kreator).
 * Panel admina (`/admin/*`) ma własną bramkę w `admin-a11y.spec.ts` (4 języki × 2 szerokości).
 *
 * Dodatkowo: stany z otwartymi warstwami (menu statusu zgłoszenia, centrum powiadomień,
 * kompozytor wiadomości), przebieg z widocznym banerem cookies oraz kontrola ujemna
 * (celowo wstrzyknięty przycisk bez nazwy MUSI dać czerwony wynik).
 */

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const BLOCKING = new Set(['critical', 'serious']);

/** Trasy sprawdzane przy 320 px w `passport-panel-a11y.spec.ts`. */
const COVERED_AT_320 = new Set([
  'candidate',
  'candidate/profil',
  'employer',
  'employer/firma',
  'employer/oferty/nowa',
]);

const ROUTES = [
  'candidate',
  'candidate/aplikacje',
  'candidate/oferty-polecane',
  'candidate/onboarding',
  'candidate/profil',
  'candidate/profil/import-cv',
  'candidate/propozycje',
  'candidate/ustawienia',
  'candidate/wiadomosci',
  'candidate/wiadomosci?c=demo-conv-0',
  'candidate/wyszukiwania',
  'candidate/zapisane',
  'employer',
  'employer/aplikacje',
  'employer/aplikacje/demo-app-1',
  'employer/firma',
  'employer/firma/nowa',
  'employer/kandydaci',
  'employer/oferty',
  'employer/oferty/nowa',
  'employer/oferty/12345/edycja',
  'employer/oferty/12345/baner',
  'employer/platnosci',
  'employer/statystyki',
  'employer/ustawienia',
  'employer/wiadomosci',
  'employer/wiadomosci?c=demo-conv-0',
  'employer/zespol',
] as const;

type Copy = {
  dashboard: { statusMenuTrigger: string };
  notifications: { title: string };
  messages: { composerLabel: string };
};

function copy(locale: string): Copy {
  return JSON.parse(readFileSync(resolve(process.cwd(), 'src', 'messages', `${locale}.json`), 'utf-8')) as Copy;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Zapisana zgoda „tylko niezbędne” — strona bez banera. */
async function storeConsent(page: Page) {
  await page.context().addCookies([
    {
      name: 'pracujbe_consent',
      value: JSON.stringify({
        v: process.env.NEXT_PUBLIC_CONSENT_POLICY_VERSION ?? '1.0',
        categories: { necessary: true, preferences: false, analytics: false, marketing: false },
        ts: '2026-01-01T00:00:00.000Z',
        id: 'panel-a11y-e2e',
      }),
      url: 'http://localhost:3000',
      sameSite: 'Lax',
    },
  ]);
}

/** Konkretny stan zamiast stałego odczekania: `main` z nagłówkiem h1 i brak `aria-busy`. */
async function waitForPanel(page: Page) {
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
}

async function audit(page: Page) {
  const results = await new AxeBuilder({ page })
    .options({ rules: { 'target-size': { enabled: true } } })
    .withTags(WCAG_TAGS)
    .analyze();
  // target-size bywa `moderate` — sprawdzamy je jawnie, żeby filtr wagi go nie ukrył.
  return results.violations
    .filter((v) => BLOCKING.has(v.impact ?? '') || v.id === 'target-size')
    .map((v) => `[${v.impact}] ${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
}

const MATRIX = [
  { width: 1280, height: 900, locales: ['pl', 'en'] as const },
  { width: 320, height: 800, locales: LOCALES },
];

for (const { width, height, locales } of MATRIX) {
  for (const locale of locales) {
    test(`panele a11y: kandydat i pracodawca (${locale}, ${width} px) — brak naruszeń`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width, height });
      await storeConsent(page);
      const failures: string[] = [];
      for (const route of ROUTES) {
        if (width === 320 && COVERED_AT_320.has(route)) continue;
        await page.goto(`/${locale}/${route}`);
        await waitForPanel(page);
        const violations = await audit(page);
        if (violations.length > 0) failures.push(`/${locale}/${route}:\n  ${violations.join('\n  ')}`);
      }
      expect(failures, `Naruszenia a11y na trasach paneli:\n${failures.join('\n')}`).toEqual([]);
    });
  }
}

for (const locale of ['pl', 'en'] as const) {
  test(`panele a11y: widoczny baner cookies (${locale}, 320 px)`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    for (const route of ['candidate', 'employer/aplikacje'] as const) {
      await page.goto(`/${locale}/${route}`);
      await waitForPanel(page);
      await expect(cookieBanner(page)).toBeVisible();
      expect(await audit(page), `/${locale}/${route} z banerem`).toEqual([]);
    }
  });

  test(`panele a11y: otwarte menu statusu zgłoszenia (${locale})`, async ({ page }) => {
    const m = copy(locale);
    await storeConsent(page);
    await page.goto(`/${locale}/employer/aplikacje`);
    await waitForPanel(page);
    const prefix = m.dashboard.statusMenuTrigger.split('{name}')[0];
    const trigger = page
      .getByRole('main')
      .getByRole('button', { name: new RegExp(`^${escapeRegExp(prefix)}Piotr Nowak`) })
      .first();
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(await audit(page), `/${locale}/employer/aplikacje z otwartym menu statusu`).toEqual([]);
  });

  for (const role of ['candidate', 'employer'] as const) {
    test(`panele a11y: otwarte centrum powiadomień i kompozytor (${role}, ${locale})`, async ({ page }) => {
      const m = copy(locale);
      await storeConsent(page);
      await page.goto(`/${locale}/${role}/wiadomosci?c=demo-conv-0`);
      await waitForPanel(page);
      const composerPrefix = m.messages.composerLabel.split('{name}')[0];
      await page.getByRole('textbox', { name: new RegExp(`^${escapeRegExp(composerPrefix)}`) }).fill('Test');
      await page.getByRole('button', { name: new RegExp(`^${escapeRegExp(m.notifications.title)}`) }).click();
      await expect(page.getByRole('region', { name: m.notifications.title, exact: true })).toBeVisible();
      expect(await audit(page), `/${locale}/${role}/wiadomosci z powiadomieniami`).toEqual([]);
    });
  }
}

test('panele a11y: kontrola ujemna — przycisk bez nazwy daje naruszenie', async ({ page }) => {
  await storeConsent(page);
  await page.goto('/pl/employer/aplikacje');
  await waitForPanel(page);
  expect(await audit(page)).toEqual([]);
  await page.getByRole('main').evaluate((main) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'min-h-12 min-w-12';
    main.appendChild(button);
  });
  const violations = await audit(page);
  expect(violations.some((v) => v.includes('button-name'))).toBe(true);
});

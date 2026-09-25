import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { LOCALES, cookieBanner, messages, rejectOptionalCookies } from './fixtures/messages';

/**
 * #575 (decyzja właściciela, ePrivacy) — lejek ofert (#99) działa WYŁĄCZNIE po zgodzie
 * w kategorii analitycznej banera cookies:
 * - przed decyzją, po „Tylko niezbędne” i po wycofaniu zgody (centrum w stopce) przeglądarka
 *   nie wysyła żadnego żądania do `/api/job-funnel` — także przy zmianie strony, opuszczeniu
 *   strony (keepalive), w drugiej karcie i po restarcie (nowy kontekst z zapisanym cookie);
 *   4 języki;
 * - wyświetlenie sprzed decyzji wychodzi dopiero po zgodzie analitycznej w tej karcie;
 * - kontrola ujemna: ten sam przebieg ze zgodą wysyła zdarzenia (obserwator działa).
 *
 * #499 — po zgodzie lejek niczego nie zapisuje w urządzeniu:
 * - żądanie do `/api/job-funnel` idzie bez cookies (`credentials: 'omit'`), choć strona ma
 *   własne cookie — sprawdzamy nagłówek żądania;
 * - odpowiedź nie ustawia cookies (`Set-Cookie`);
 * - cookies, localStorage, sessionStorage i IndexedDB są takie same przed zdarzeniem i po nim,
 *   a nonce zdarzenia nie trafia do żadnego z nich (żyje tylko w pamięci karty).
 *
 * Serwer fixture (`playwright.applications-fixture.config.ts`, tryb full): oferty fikcyjne nie
 * mają flagi demo, więc wyspa `JobFunnelBeacon` wysyła zdarzenia jak przy ofertach z bazy.
 */

const JOB_SLUG = 'warehouse-worker-antwerp-1001';
const JOB_PATH = `/pl/oferty-pracy/${JOB_SLUG}`;
const LIST_PATH = '/pl/oferty-pracy';
const PROBE_COOKIE = { name: 'e2e_probe', value: 'must-not-reach-funnel' };
const CONSENT_COOKIE = 'pracujbe_consent';

/** Teksty centrum ustawień cookies (spoza wspólnego typu `messages`). */
function cookieTexts(locale: string): {
  settingsTitle: string;
  analyticsName: string;
  save: string;
  customize: string;
  footerSettings: string;
} {
  const raw = JSON.parse(readFileSync(resolve(process.cwd(), 'src', 'messages', `${locale}.json`), 'utf-8')) as {
    cookies: Record<string, string>;
    footer: Record<string, string>;
  };
  return {
    settingsTitle: raw.cookies.settingsTitle!,
    analyticsName: raw.cookies.analyticsName!,
    save: raw.cookies.save!,
    customize: raw.cookies.customize!,
    footerSettings: raw.footer.cookieSettings!,
  };
}

/** Zgoda zapisana wcześniej (poprzednia wizyta / restart przeglądarki). */
async function storeConsent(context: BrowserContext, baseURL: string, analytics: boolean) {
  await context.addCookies([{
    name: CONSENT_COOKIE,
    value: encodeURIComponent(JSON.stringify({
      v: process.env.NEXT_PUBLIC_CONSENT_POLICY_VERSION ?? '2.0',
      categories: { necessary: true, preferences: false, analytics, marketing: false },
      ts: '2026-01-01T00:00:00.000Z',
      id: 'job-funnel-e2e',
    })),
    url: baseURL,
  }]);
}

/**
 * Cookies samego `next dev` (serwer fixture), ustawiane asynchronicznie przez klienta HMR —
 * nie istnieją w buildzie produkcyjnym i nie mają związku z lejkiem.
 */
const DEV_SERVER_COOKIES = new Set(['__next_hmr_refresh_hash__']);

interface DeviceState {
  cookies: string[];
  local: Record<string, string>;
  session: Record<string, string>;
  idb: string[];
}

async function deviceState(page: Page, context: BrowserContext): Promise<DeviceState> {
  const cookies = (await context.cookies())
    .filter((c) => !DEV_SERVER_COOKIES.has(c.name))
    .map((c) => `${c.name}=${c.value}`)
    .sort();
  const storage = await page.evaluate(async () => {
    const dump = (s: Storage) => Object.fromEntries(Object.keys(s).sort().map((k) => [k, s.getItem(k) ?? '']));
    const dbs = typeof indexedDB.databases === 'function' ? await indexedDB.databases() : [];
    return {
      local: dump(window.localStorage),
      session: dump(window.sessionStorage),
      idb: dbs.map((d) => d.name ?? '').sort(),
    };
  });
  return { cookies, ...storage };
}

function contains(state: DeviceState, needle: string): boolean {
  return JSON.stringify(state).includes(needle);
}

interface Captured {
  /** Nagłówki żądania wysłanego przez przeglądarkę. */
  headers: Record<string, string>;
  body: { event: string; nonce: string; jobIds: string[] };
  setCookie: string | undefined;
  /** Stan urządzenia w chwili wysyłki (przed odpowiedzią serwera). */
  before: DeviceState;
  /** Odpowiedź serwera już przekazana przeglądarce (`setCookie` ustalone). */
  done: boolean;
}

/**
 * Przechwytuje żądania lejka przez `context.route` (wszystkie karty kontekstu) — `fetch`
 * z `keepalive` nie emituje w Playwright zdarzenia `requestfinished`, więc odpowiedź pobieramy
 * sami i oddajemy przeglądarce bez zmian.
 */
async function watchFunnel(context: BrowserContext): Promise<Captured[]> {
  const captured: Captured[] = [];
  await context.route('**/api/job-funnel', async (route) => {
    const request = route.request();
    const headers = await request.allHeaders();
    const page = request.frame().page();
    const before = await deviceState(page, context);
    // Wpis od razu przy żądaniu: pierwsza kompilacja trasy w `next dev` bywa wolna.
    const entry: Captured = {
      headers,
      body: JSON.parse(request.postData() ?? '{}') as Captured['body'],
      setCookie: undefined,
      before,
      done: false,
    };
    captured.push(entry);
    const response = await route.fetch();
    entry.setCookie = response.headers()['set-cookie'];
    entry.done = true;
    await route.fulfill({ response });
  });
  return captured;
}

async function expectRequestClean(entry: Captured) {
  await expect.poll(() => entry.done, 'odpowiedź lejka dotarła').toBe(true);
  expect(entry.headers.cookie, 'żądanie lejka nie może nieść cookies').toBeUndefined();
  expect(entry.setCookie, 'odpowiedź lejka nie może ustawiać cookies').toBeUndefined();
  expect(entry.body.nonce).toMatch(/^[0-9a-f-]{36}$/);
}

/**
 * Strona po załadowaniu i chwili na hydratację — wyspa lejka miała okazję wysłać zdarzenie.
 * (`networkidle` nie nadaje się: lista ofert w `next dev` nie milknie.) Ta sama pauza w
 * przebiegu ze zgodą wystarcza, by zdarzenie dotarło — kontrola ujemna w teście wycofania.
 */
async function settle(page: Page) {
  await page.waitForLoadState('load');
  await page.waitForTimeout(2000);
}

const funnelSettings = (page: Page, locale: string) =>
  page.getByRole('dialog', { name: cookieTexts(locale).settingsTitle });

/** Centrum w stopce: ustawia kategorię analityczną i zapisuje. */
async function setAnalyticsFromFooter(page: Page, locale: string, on: boolean) {
  const t = cookieTexts(locale);
  await page.getByRole('contentinfo').getByRole('button', { name: t.footerSettings, exact: true }).click();
  const dialog = funnelSettings(page, locale);
  await expect(dialog).toBeVisible();
  const toggle = dialog.getByRole('switch', { name: t.analyticsName });
  if ((await toggle.getAttribute('aria-checked')) !== String(on)) await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', String(on));
  await dialog.getByRole('button', { name: t.save, exact: true }).click();
  await expect(dialog).toBeHidden();
}

async function openApply(page: Page, locale: string) {
  await page.getByRole('button', { name: messages(locale).jobs.applyNow }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
}

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ ...PROBE_COOKIE, url: baseURL! }]);
});

for (const locale of LOCALES) {
  const job = `/${locale}/oferty-pracy/${JOB_SLUG}`;
  const list = `/${locale}/oferty-pracy`;

  test(`(${locale}) przed decyzją zero żądań lejka: szczegół, „Aplikuj”, zmiana strony i opuszczenie`, async ({ page, context }) => {
    test.setTimeout(240_000);
    const captured = await watchFunnel(context);
    await page.goto(job);
    await expect(page.getByRole('button', { name: messages(locale).cookies.acceptAll })).toBeVisible();
    await openApply(page, locale);
    await settle(page);
    await page.goto(list);
    await settle(page);
    await page.goto(job);
    await settle(page);
    expect(captured, 'przed decyzją').toEqual([]);
  });

  test(`(${locale}) po „Tylko niezbędne” zero żądań lejka: „Aplikuj”, zmiana strony, odświeżenie`, async ({ page, context }) => {
    test.setTimeout(240_000);
    const captured = await watchFunnel(context);
    await page.goto(job);
    await rejectOptionalCookies(page, locale);
    await openApply(page, locale);
    await settle(page);
    await page.goto(list);
    await settle(page);
    await page.reload();
    await settle(page);
    expect(captured, 'po odmowie').toEqual([]);
  });

  test(`(${locale}) restart przeglądarki z zapisaną odmową: zero żądań lejka`, async ({ browser, baseURL }) => {
    test.setTimeout(240_000);
    const restarted = await browser.newContext();
    try {
      await restarted.addCookies([{ ...PROBE_COOKIE, url: baseURL! }]);
      await storeConsent(restarted, baseURL!, false);
      const captured = await watchFunnel(restarted);
      const tab = await restarted.newPage();
      await tab.goto(job);
      await openApply(tab, locale);
      await settle(tab);
      await tab.goto(list);
      await settle(tab);
      expect(captured, 'po restarcie z odmową').toEqual([]);
    } finally {
      await restarted.close();
    }
  });

  test(`(${locale}) wycofanie zgody: w tej karcie i w drugiej karcie — kolejne zdarzenia nie wychodzą`, async ({ page, context, baseURL }) => {
    test.setTimeout(240_000);
    await storeConsent(context, baseURL!, true);
    const captured = await watchFunnel(context);
    const sent = () => captured.map((c) => c.body.event);

    // Kontrola ujemna obserwatora: ze zgodą wyświetlenie wychodzi.
    await page.goto(job);
    await expect.poll(() => sent().length).toBe(1);

    // Wycofanie w tej karcie (centrum w stopce): „Aplikuj” nie wysyła apply_started.
    await setAnalyticsFromFooter(page, locale, false);
    await openApply(page, locale);
    await settle(page);
    expect(sent()).toEqual(['detail_view']);

    // Ponowna zgoda w tej karcie, odświeżenie = nowe wyświetlenie.
    await setAnalyticsFromFooter(page, locale, true);
    await page.reload();
    await expect.poll(() => sent().length).toBe(2);

    // Druga karta wycofuje zgodę; pierwsza (bez zdarzenia zgody w swojej karcie) nie wysyła.
    const second = await context.newPage();
    await second.goto(list);
    await expect.poll(() => sent().filter((e) => e === 'search_appearance').length).toBe(1);
    await setAnalyticsFromFooter(second, locale, false);
    await openApply(page, locale);
    await settle(page);
    await second.close();
    expect(sent().sort()).toEqual(['detail_view', 'detail_view', 'search_appearance']);

    // Po wycofaniu: zmiana strony, powrót i odświeżenie — nadal nic.
    await page.goto(list);
    await settle(page);
    await page.goto(job);
    await openApply(page, locale);
    await page.reload();
    await settle(page);
    expect(captured).toHaveLength(3);
  });
}

test('wyświetlenie sprzed decyzji wychodzi dopiero po zgodzie analitycznej, raz', async ({ page, context }) => {
  const captured = await watchFunnel(context);
  await page.goto(JOB_PATH);
  await settle(page);
  expect(captured).toEqual([]);

  const t = cookieTexts('pl');
  await cookieBanner(page).getByRole('button', { name: t.customize, exact: true }).click();
  const dialog = funnelSettings(page, 'pl');
  await dialog.getByRole('switch', { name: t.analyticsName }).click();
  await dialog.getByRole('button', { name: t.save, exact: true }).click();
  await expect.poll(() => captured.filter((c) => c.body.event === 'detail_view').length).toBe(1);
  await settle(page);
  expect(captured).toHaveLength(1);
});

test('po zgodzie: detail_view i apply_started bez cookies i storage (#499)', async ({ page, context, baseURL }) => {
  await storeConsent(context, baseURL!, true);
  const captured = await watchFunnel(context);

  await page.goto(JOB_PATH);
  await expect.poll(() => captured.filter((c) => c.body.event === 'detail_view').length).toBe(1);
  const afterView = await deviceState(page, context);

  // Otwarcie formularza = `apply_started` (ten sam nonce co wyświetlenie).
  await page.getByRole('button', { name: messages('pl').jobs.applyNow }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect.poll(() => captured.filter((c) => c.body.event === 'apply_started').length).toBe(1);
  const afterApply = await deviceState(page, context);

  expect(afterApply).toEqual(afterView);
  expect(afterView).toEqual(captured[0]!.before);
  // Jedyne cookies w urządzeniu: sonda testu, zgoda i `NEXT_LOCALE` z odpowiedzi strony
  // (middleware next-intl, niezależne od lejka — opis w docs/legal-drafts/eprivacy-lejek.md).
  expect(
    afterView.cookies.map((c) => c.split('=')[0]).filter((n) => n !== 'NEXT_LOCALE').sort(),
  ).toEqual([PROBE_COOKIE.name, CONSENT_COOKIE].sort());
  for (const entry of captured) {
    await expectRequestClean(entry);
    expect(contains(afterApply, entry.body.nonce), 'nonce nie może trafić do urządzenia').toBe(false);
  }
  const [view, apply] = captured;
  expect(apply!.body.nonce).toBe(view!.body.nonce);

  // Odświeżenie = nowe wyświetlenie z nowym nonce — nic nie przetrwało w urządzeniu.
  await page.reload();
  await expect.poll(() => captured.filter((c) => c.body.event === 'detail_view').length).toBe(2);
  expect(captured.filter((c) => c.body.event === 'detail_view')[1]!.body.nonce).not.toBe(view!.body.nonce);
});

test('po zgodzie: lista ofert — search_appearance bez cookies i storage (#499)', async ({ page, context, baseURL }) => {
  await storeConsent(context, baseURL!, true);
  const captured = await watchFunnel(context);
  await page.goto(LIST_PATH);
  await expect.poll(() => captured.filter((c) => c.body.event === 'search_appearance').length).toBe(1);
  const after = await deviceState(page, context);

  const [entry] = captured;
  expect(after).toEqual(entry!.before);
  expect(entry!.body.jobIds.length).toBeGreaterThan(0);
  await expectRequestClean(entry!);
  expect(contains(after, entry!.body.nonce)).toBe(false);
});

test('kontrola ujemna: porównanie stanu urządzenia wykrywa zapis w storage i cookie', async ({ page, context }) => {
  await page.goto(JOB_PATH);
  const before = await deviceState(page, context);
  await page.evaluate(() => {
    window.localStorage.setItem('funnel_nonce', 'leak');
    document.cookie = 'funnel_id=leak; path=/';
  });
  const after = await deviceState(page, context);
  expect(after).not.toEqual(before);
  expect(contains(after, 'leak')).toBe(true);
});

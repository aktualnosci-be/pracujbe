import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { messages } from './fixtures/messages';

/**
 * #499 — serwerowy lejek ofert (#99) przed zgodą na cookies niczego nie zapisuje w urządzeniu:
 * - żądanie do `/api/job-funnel` idzie bez cookies (`credentials: 'omit'`), choć strona ma
 *   własne cookie — sprawdzamy nagłówek żądania;
 * - odpowiedź nie ustawia cookies (`Set-Cookie`);
 * - cookies, localStorage, sessionStorage i IndexedDB są takie same przed zdarzeniem i po nim,
 *   a nonce zdarzenia nie trafia do żadnego z nich (żyje tylko w pamięci karty);
 * - zgoda nie została udzielona (baner widoczny, brak cookie zgody).
 *
 * Serwer fixture (`playwright.applications-fixture.config.ts`, tryb full): oferty fikcyjne nie
 * mają flagi demo, więc wyspa `JobFunnelBeacon` wysyła zdarzenia jak przy ofertach z bazy.
 */

const JOB_PATH = '/pl/oferty-pracy/warehouse-worker-antwerp-1001';
const LIST_PATH = '/pl/oferty-pracy';
const PROBE_COOKIE = { name: 'e2e_probe', value: 'must-not-reach-funnel' };

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
}

/**
 * Przechwytuje żądania lejka przez `page.route` — `fetch` z `keepalive` nie emituje w Playwright
 * zdarzenia `requestfinished`, więc odpowiedź pobieramy sami i oddajemy przeglądarce bez zmian.
 */
async function watchFunnel(page: Page, context: BrowserContext): Promise<Captured[]> {
  const captured: Captured[] = [];
  await page.route('**/api/job-funnel', async (route) => {
    const request = route.request();
    const headers = await request.allHeaders();
    const before = await deviceState(page, context);
    const response = await route.fetch();
    captured.push({
      headers,
      body: JSON.parse(request.postData() ?? '{}') as Captured['body'],
      setCookie: response.headers()['set-cookie'],
      before,
    });
    await route.fulfill({ response });
  });
  return captured;
}

async function expectNoConsent(page: Page, context: BrowserContext) {
  const t = messages('pl');
  await expect(page.getByRole('button', { name: t.cookies.acceptAll })).toBeVisible();
  expect((await context.cookies()).some((c) => c.name === 'pracujbe_consent')).toBe(false);
}

function expectRequestClean(entry: Captured) {
  expect(entry.headers.cookie, 'żądanie lejka nie może nieść cookies').toBeUndefined();
  expect(entry.setCookie, 'odpowiedź lejka nie może ustawiać cookies').toBeUndefined();
  expect(entry.body.nonce).toMatch(/^[0-9a-f-]{36}$/);
}

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ ...PROBE_COOKIE, url: baseURL! }]);
});

test('szczegół oferty: detail_view i apply_started bez cookies i storage przed zgodą', async ({ page, context }) => {
  const captured = await watchFunnel(page, context);

  await page.goto(JOB_PATH);
  await expectNoConsent(page, context);
  await expect.poll(() => captured.filter((c) => c.body.event === 'detail_view').length).toBe(1);
  const afterView = await deviceState(page, context);

  // Otwarcie formularza = `apply_started` (ten sam nonce co wyświetlenie).
  await page.getByRole('button', { name: messages('pl').jobs.applyNow }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect.poll(() => captured.filter((c) => c.body.event === 'apply_started').length).toBe(1);
  const afterApply = await deviceState(page, context);

  expect(afterApply).toEqual(afterView);
  expect(afterView).toEqual(captured[0]!.before);
  // Jedyne cookies w urządzeniu: sonda testu i `NEXT_LOCALE` z odpowiedzi strony (middleware
  // next-intl, niezależne od lejka — opis w docs/legal-drafts/eprivacy-lejek.md).
  expect(afterView.cookies.map((c) => c.split('=')[0]).filter((n) => n !== 'NEXT_LOCALE')).toEqual([PROBE_COOKIE.name]);
  for (const entry of captured) {
    expectRequestClean(entry);
    expect(contains(afterApply, entry.body.nonce), 'nonce nie może trafić do urządzenia').toBe(false);
  }
  const [view, apply] = captured;
  expect(apply!.body.nonce).toBe(view!.body.nonce);

  // Odświeżenie = nowe wyświetlenie z nowym nonce — nic nie przetrwało w urządzeniu.
  await page.reload();
  await expect.poll(() => captured.filter((c) => c.body.event === 'detail_view').length).toBe(2);
  expect(captured.filter((c) => c.body.event === 'detail_view')[1]!.body.nonce).not.toBe(view!.body.nonce);
  await expectNoConsent(page, context);
});

test('lista ofert: search_appearance bez cookies i storage przed zgodą', async ({ page, context }) => {
  const captured = await watchFunnel(page, context);
  await page.goto(LIST_PATH);
  await expectNoConsent(page, context);
  await expect.poll(() => captured.filter((c) => c.body.event === 'search_appearance').length).toBe(1);
  const after = await deviceState(page, context);

  const [entry] = captured;
  expect(after).toEqual(entry!.before);
  expect(entry!.body.jobIds.length).toBeGreaterThan(0);
  expectRequestClean(entry!);
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

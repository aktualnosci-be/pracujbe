import { expect, test } from '@playwright/test';

/** Test token is injected by playwright.config.ts; all tracker requests are intercepted. */
const TRACKER_URL = /^https:\/\/([a-z0-9.-]*\.)?cloudflareinsights\.com\//;
const SECRET = 'B'.repeat(43);

test('jednorazowe linki nie uruchamiają beaconu Cloudflare Web Analytics po wcześniejszej zgodzie', async ({ page, context, baseURL }) => {
  const consent = {
    v: process.env.NEXT_PUBLIC_CONSENT_POLICY_VERSION ?? '2.0',
    categories: { necessary: true, preferences: true, analytics: true, marketing: true },
    ts: new Date().toISOString(),
    id: 'one-time-link-tracking-e2e',
  };
  await context.addCookies([{
    name: 'pracujbe_consent',
    value: encodeURIComponent(JSON.stringify(consent)),
    url: baseURL!,
    sameSite: 'Lax',
  }]);

  const trackerRequests: string[] = [];
  await page.route(TRACKER_URL, async (route) => {
    trackerRequests.push(route.request().url());
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
  });

  // Positive control: the consent is accepted and test tracker IDs are really in this build.
  await page.goto('/pl');
  await expect.poll(() => trackerRequests.length).toBeGreaterThan(0);

  for (const path of [
    `/pl/aplikacja/przejmij#token=${SECRET}`,
    `/pl/aplikacja/potwierdz?token=${SECRET}`,
    `/pl/ustaw-nowe-haslo?token=${SECRET}`,
    `/pl/ustaw-nowe-haslo#token=${SECRET}`,
    `/pl/potwierdz-email#token=a.${SECRET}.b`,
    `/pl/wypisz?t=${SECRET}`,
  ]) {
    trackerRequests.length = 0;
    const response = await page.goto(path);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1_000);
    expect(trackerRequests, `zewnętrzne żądania na ${path.split(/[?#]/)[0]}`).toEqual([]);
    expect(response?.headers()['cache-control'], 'jednorazowy link bez cache').toContain('no-store');
    expect(response?.headers()['referrer-policy'], 'jednorazowy link bez Referer').toBe('no-referrer');
  }
});

test('nawigacja kliencka z trasy publicznej na prywatną nie zostaje w karcie z beaconem (#1046)', async ({ page, context, baseURL }) => {
  const consent = {
    v: process.env.NEXT_PUBLIC_CONSENT_POLICY_VERSION ?? '2.0',
    categories: { necessary: true, preferences: true, analytics: true, marketing: true },
    ts: new Date().toISOString(),
    id: 'spa-navigation-tracking-e2e',
  };
  await context.addCookies([{
    name: 'pracujbe_consent',
    value: encodeURIComponent(JSON.stringify(consent)),
    url: baseURL!,
    sameSite: 'Lax',
  }]);

  const trackerRequests: string[] = [];
  await page.route(TRACKER_URL, async (route) => {
    trackerRequests.push(route.request().url());
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
  });

  await page.goto('/pl');
  await expect.poll(() => trackerRequests.length).toBeGreaterThan(0);
  // Beacon dostaje wyłączone śledzenie nawigacji SPA.
  const config = await page.locator('script#cf-web-analytics').getAttribute('data-cf-beacon');
  expect(JSON.parse(config!)).toMatchObject({ spa: false });

  // Znacznik w oknie: znika tylko przy pełnym przeładowaniu dokumentu (klik SPA go zachowuje).
  await page.evaluate(() => { (window as unknown as { __spaMarker?: string }).__spaMarker = 'same-document'; });
  trackerRequests.length = 0;

  await page.locator('a[href$="/pl/logowanie"]').first().click();
  await page.waitForURL(/\/pl\/logowanie$/);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1_000);

  expect(
    await page.evaluate(() => (window as unknown as { __spaMarker?: string }).__spaMarker),
    'przejście na trasę prywatną ma być pełnym przeładowaniem (nowy dokument bez beaconu)',
  ).toBeUndefined();
  expect(await page.locator('script#cf-web-analytics').count()).toBe(0);
  expect(trackerRequests, 'zewnętrzne żądania po przejściu na /pl/logowanie').toEqual([]);
});

test('strona publiczna otwarta z trasy prywatnej w nowej karcie nie dostaje jej ścieżki ani query jako referrera (#1218)', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin;

  async function referrerOfNewTab(): Promise<string> {
    const [popup] = await Promise.all([
      context.waitForEvent('page'),
      page.evaluate(() => { window.open('/pl/pomoc', '_blank'); }),
    ]);
    await popup.waitForLoadState('domcontentloaded');
    const referrer = await popup.evaluate(() => document.referrer);
    await popup.close();
    return referrer;
  }

  const privatePath = '/pl/logowanie?next=%2Fpl%2Fadmin%2Fuzytkownicy%3Fq%3Djan%2540example.com';
  const response = await page.goto(privatePath);
  expect(response?.headers()['referrer-policy'], 'trasa prywatna z polityką bez ścieżki').toBe('strict-origin');
  expect(await referrerOfNewTab(), 'referrer = sam origin').toBe(`${origin}/`);

  // Kontrola ujemna: ze strony publicznej (polityka globalna) referrer niesie ścieżkę i query,
  // więc test rozpoznałby brak nadpisania na trasie prywatnej.
  await page.goto('/pl/oferty-pracy?keyword=magazyn');
  expect(await referrerOfNewTab()).toContain('/pl/oferty-pracy?keyword=magazyn');
});

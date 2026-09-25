import { expect, test } from '@playwright/test';

/** Test IDs are injected by playwright.config.ts; all tracker requests are intercepted. */
const TRACKER_URL = /^https:\/\/(www\.googletagmanager\.com|[a-z0-9.-]*google-analytics\.com|connect\.facebook\.net|www\.facebook\.com)\//;
const SECRET = 'B'.repeat(43);

test('jednorazowe linki nie uruchamiają GA ani Meta po wcześniejszej zgodzie', async ({ page, context, baseURL }) => {
  const consent = {
    v: process.env.NEXT_PUBLIC_CONSENT_POLICY_VERSION ?? '1.0',
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

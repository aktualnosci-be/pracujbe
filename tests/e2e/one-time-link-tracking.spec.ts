import { expect, test } from '@playwright/test';

import { buildHasCfToken, watchAnalytics } from './fixtures/trackers';

/** Test token is injected by playwright.config.ts; all analytics requests are intercepted (#570). */
const SECRET = 'B'.repeat(43);

test('jednorazowe linki nie uruchamiają statystyki po wcześniejszej zgodzie', async ({ page, context, baseURL }) => {
  const consent = {
    v: process.env.NEXT_PUBLIC_CONSENT_POLICY_VERSION ?? '2.0',
    categories: { necessary: true, preferences: false, analytics: true, marketing: false },
    ts: new Date().toISOString(),
    id: 'one-time-link-tracking-e2e',
  };
  await context.addCookies([{
    name: 'pracujbe_consent',
    value: encodeURIComponent(JSON.stringify(consent)),
    url: baseURL!,
    sameSite: 'Lax',
  }]);

  const seen = await watchAnalytics(page);
  const trackerRequests = () => [...seen.script, ...seen.rum, ...seen.legacy];

  // Positive control: the consent is accepted and the test token is really in this build.
  // Without the token (CI build before ci.yml gets NEXT_PUBLIC_CF_ANALYTICS_TOKEN, #570) the
  // control is reported as an annotation; the negative checks below still run.
  await page.goto('/pl');
  if (buildHasCfToken()) {
    await expect.poll(() => seen.script.length).toBeGreaterThan(0);
  } else {
    test.info().annotations.push({ type: 'skip-positive-control', description: 'build bez testowego tokenu Cloudflare (#570)' });
  }

  for (const path of [
    `/pl/aplikacja/przejmij#token=${SECRET}`,
    `/pl/aplikacja/potwierdz?token=${SECRET}`,
    `/pl/ustaw-nowe-haslo?token=${SECRET}`,
    `/pl/ustaw-nowe-haslo#token=${SECRET}`,
    `/pl/potwierdz-email#token=a.${SECRET}.b`,
    `/pl/wypisz?t=${SECRET}`,
  ]) {
    seen.script.length = 0;
    seen.rum.length = 0;
    seen.legacy.length = 0;
    // Pełne przeładowanie: skrypt z poprzedniej strony nie może przenieść się na link.
    const response = await page.goto(path);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1_000);
    expect(trackerRequests(), `zewnętrzne żądania na ${path.split(/[?#]/)[0]}`).toEqual([]);
    expect(response?.headers()['cache-control'], 'jednorazowy link bez cache').toContain('no-store');
    expect(response?.headers()['referrer-policy'], 'jednorazowy link bez Referer').toBe('no-referrer');
  }
});

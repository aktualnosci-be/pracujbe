import { expect, test, type BrowserContext } from '@playwright/test';

/**
 * #389 — baner zgód jest w HTML z serwera, więc maluje się razem z FCP i nie czeka na
 * hydratację (wcześniej był elementem LCP po ~2 s przy pierwszej wizycie).
 * #388 — polskie, niderlandzkie i francuskie znaki renderują się podzbiorem DM Sans (wcześniej Inter; font od #5/#7).
 *
 * „Pierwsza klatka” sprawdzamy z zablokowanym JS: to, co widać wtedy, to HTML z serwera
 * + skrypt inline z <head> + CSS — dokładnie stan przed hydratacją.
 */

const BANNER = '#cookie-banner';

async function storeConsent(context: BrowserContext, baseURL: string): Promise<void> {
  await context.addCookies([
    {
      name: 'pracujbe_consent',
      value: encodeURIComponent(
        JSON.stringify({
          v: process.env.NEXT_PUBLIC_CONSENT_POLICY_VERSION ?? '1.0',
          categories: { necessary: true, preferences: false, analytics: false, marketing: false },
          ts: '2026-01-01T00:00:00.000Z',
          id: 'first-visit-lcp-e2e',
        }),
      ),
      url: baseURL,
      sameSite: 'Lax',
    },
  ]);
}

async function blockScripts(context: BrowserContext): Promise<void> {
  await context.route(/\/_next\/static\/.*\.js(\?|$)/, (route) => route.abort());
}

const PATHS = ['/pl/oferty-pracy', '/pl/oferty-pracy/bricklayer-brussels-1002', '/pl/logowanie'];

for (const path of PATHS) {
  test(`baner zgód jest w HTML z serwera: ${path}`, async ({ request }) => {
    const html = await (await request.get(path)).text();
    expect(html).toContain('id="cookie-banner"');
    expect(html).toContain('id="cookie-banner-desc"');
    expect(html).toContain('data-consent');
  });

  test(`pierwsza wizyta: baner widoczny przed hydratacją: ${path}`, async ({ page, context }) => {
    await blockScripts(context);
    await page.goto(path);
    await expect(page.locator(BANNER)).toBeVisible();
  });

  test(`z zapisaną zgodą baner nie mignie: ${path}`, async ({ page, context, baseURL }) => {
    await storeConsent(context, baseURL ?? 'http://localhost:3000');
    await blockScripts(context);
    await page.goto(path);
    await expect(page.locator('html')).toHaveAttribute('data-consent', 'set');
    await expect(page.locator(BANNER)).toBeHidden();
  });
}

test('z zapisaną zgodą baner znika z DOM po hydratacji, bez błędów hydratacji', async ({
  page,
  context,
  baseURL,
}) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await storeConsent(context, baseURL ?? 'http://localhost:3000');
  await page.goto('/pl/oferty-pracy');
  await expect(page.locator(BANNER)).toHaveCount(0);
  expect(errors.filter((e) => /hydrat/i.test(e))).toEqual([]);
});

test('bez zgody: baner zostaje po hydratacji, skrypt z <head> nie ukrył go', async ({ page }) => {
  await page.goto('/pl/oferty-pracy');
  await expect(page.locator(BANNER)).toBeVisible();
  await expect(page.locator('html')).not.toHaveAttribute('data-consent', 'set');
});

const SAMPLES: Record<string, string> = {
  pl: 'ąćęłńóśźż ĄĆĘŁŃÓŚŹŻ „cytat”',
  nl: 'ĳ ë ï ü café’s',
  fr: 'éèêëàâçîïôûùœ « guillemets » €',
};

for (const [locale, sample] of Object.entries(SAMPLES)) {
  test(`znaki ${locale} renderują się DM Sans (podzbiór #388)`, async ({ page, context }) => {
    await page.goto(`/${locale}`);
    await page.evaluate((text) => {
      const probe = document.createElement('p');
      probe.id = 'font-probe';
      probe.className = 'font-sans';
      probe.textContent = text;
      document.body.append(probe);
    }, sample);
    await page.evaluate(async () => {
      await document.fonts.ready;
    });

    const cdp = await context.newCDPSession(page);
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument');
    const { nodeId } = await cdp.send('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: '#font-probe',
    });
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    // Wszystkie glify (poza spacjami, które też są w DM Sans) z jednego fontu — DM Sans.
    expect(fonts.map((f) => f.familyName)).toEqual([expect.stringMatching(/^DM Sans/)]);
    expect(fonts[0]?.isCustomFont).toBe(true);
  });
}

test('bez JS baner nie zasłania treści (nieobsługiwalny, a trackery się nie ładują)', async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/pl/oferty-pracy');
  await expect(page.locator(BANNER)).toBeHidden();
  await context.close();
});

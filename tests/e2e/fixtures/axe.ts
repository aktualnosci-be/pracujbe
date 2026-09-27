import AxeBuilderBase from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/**
 * Wspólne czekanie na „gotową” stronę przed axe i asercjami metadanych (flaki CI przy
 * `failOnFlakyTests`, 09.2026).
 *
 * Next 15 strumieniuje metadane (`<title>`, `<meta name="robots">`) osobno od treści. Po
 * nawigacji klienckiej (klik w link, `router.push`, `router.refresh()` po akcji serwera) nowa
 * treść (np. H1) bywa już widoczna, a:
 *   - stary `<title>` został odmontowany, nowy jeszcze nie dotarł — axe zgłasza wtedy
 *     `[serious] document-title` (admin-email-campaigns, admin-breaches, admin-ux…);
 *   - w DOM są naraz dwa `meta[name="robots"]` (poprzedniej i nowej trasy) — ścisły lokator
 *     rzuca „strict mode violation” (admin-campaign-banner).
 * Pod obciążeniem CI (3 workery) okno jest dłuższe. Czekamy na stan końcowy zamiast go zakładać;
 * asercji nie osłabiamy. Import zamiast `@axe-core/playwright` wymusza strażnik
 * `tests/unit/e2e-axe-ready.test.ts`.
 */

const TITLE_WAIT_MS = 10_000;

/**
 * Czeka, aż dokument ma niepusty `<title>`. Po limicie nie rzuca — analiza axe rusza i zgłosi
 * `document-title` jak dotąd (strona bez tytułu to realny błąd, nie flaka).
 */
export async function waitForDocumentTitle(page: Page, timeoutMs = TITLE_WAIT_MS): Promise<boolean> {
  return page
    .waitForFunction(() => document.title.trim() !== '', null, { timeout: timeoutMs, polling: 50 })
    .then(() => true)
    .catch(() => false);
}

/** `AxeBuilder` z `@axe-core/playwright`, który przed `analyze()` czeka na tytuł dokumentu. */
export class AxeBuilder extends AxeBuilderBase {
  private readonly readyPage: Page;

  constructor(params: ConstructorParameters<typeof AxeBuilderBase>[0]) {
    super(params);
    this.readyPage = params.page;
  }

  override async analyze(): ReturnType<AxeBuilderBase['analyze']> {
    await waitForDocumentTitle(this.readyPage);
    return super.analyze();
  }
}

export default AxeBuilder;

/**
 * Strona nie pozwala indeksować, niezależnie od chwili nawigacji klienckiej: co najmniej jeden
 * `meta[name="robots"]`, żaden bez `noindex` (po nawigacji mogą być dwa naraz), a świeży dokument
 * tej trasy — nie pozostałość poprzedniej — sam niesie `noindex`.
 */
export async function expectNoindex(page: Page): Promise<void> {
  await expect(page.locator('meta[name="robots"]').first()).toBeAttached();
  await expect(page.locator('meta[name="robots"]:not([content*="noindex"])')).toHaveCount(0);
  const html = await (await page.request.get(page.url())).text();
  expect(html, 'dokument trasy niesie noindex').toMatch(/<meta name="robots" content="[^"]*noindex/);
}

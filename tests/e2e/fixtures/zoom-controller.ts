import { resolve } from 'node:path';
import type { BrowserContext, Page } from '@playwright/test';

/**
 * Rzeczywiste powiększenie przeglądarki (chrome.tabs.setZoom) przez rozszerzenie testowe.
 *
 * Wcześniej API wołaliśmy w service workerze rozszerzenia, ale Playwright czasem nie widzi
 * go wcale (`waitForEvent('serviceworker')` wisiało do limitu testu — flaky, #375). Strona
 * rozszerzenia ma to samo API `chrome.tabs` i ładuje się jak każda karta. Stały identyfikator
 * wynika z klucza `key` w manifeście.
 */
export const ZOOM_EXTENSION_PATH = resolve(__dirname, 'browser-zoom');
export const ZOOM_EXTENSION_ARGS = [
  `--disable-extensions-except=${ZOOM_EXTENSION_PATH}`,
  `--load-extension=${ZOOM_EXTENSION_PATH}`,
];
const ZOOM_EXTENSION_ID = 'gcaddbnkbmdjgkgkgmgmlgedkjalgcnl';

/**
 * Otwiera kartę rozszerzenia; jej `evaluate` ma dostęp do `chrome.tabs`. Testowana karta
 * wraca na pierwszy plan, żeby przeglądarka nie dławiła jej jako karty w tle.
 */
export async function openZoomController(context: BrowserContext, page: Page): Promise<Page> {
  const controller = await context.newPage();
  await controller.goto(`chrome-extension://${ZOOM_EXTENSION_ID}/controller.html`);
  await page.bringToFront();
  return controller;
}

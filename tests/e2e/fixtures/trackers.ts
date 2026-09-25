import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

import type { Page } from '@playwright/test';

/**
 * Statystyka w buildzie E2E (#570, wcześniej #234): testowy token Cloudflare Web Analytics.
 * Nie należy do żadnej witryny; żądania do Cloudflare są w testach przechwytywane
 * (`watchAnalytics`) — zero realnego ruchu. GA i Meta Pixel usunięte z kodu; ich hosty
 * obserwujemy nadal, żeby wykryć powrót.
 */
export const E2E_CF_ANALYTICS_TOKEN = '0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e';

/** Dawne trackery (GA/Meta) — od #570 żadne żądanie nie może tam wyjść. */
export const LEGACY_TRACKER_URL =
  /^https:\/\/(www\.googletagmanager\.com|[a-z0-9.-]*google-analytics\.com|connect\.facebook\.net|www\.facebook\.com)\//;
/** Skrypt i wysyłki beaconu Cloudflare Web Analytics. */
export const CF_URL = /^https:\/\/([a-z0-9-]+\.)?cloudflareinsights\.com\//;
export const CF_SCRIPT = 'script[src*="static.cloudflareinsights.com"]';

/**
 * Czy gotowy build (.next) ma wklejony testowy token (NEXT_PUBLIC_* trafia do bundla przy
 * `next build`). Bez niego pozytywny scenariusz „po zgodzie beacon się ładuje” nie ma czego
 * sprawdzić — testy go wtedy jawnie pomijają (do czasu dodania tokenu do builda w ci.yml).
 */
export function buildHasCfToken(root = process.cwd()): boolean {
  // Serwer `next dev` z tokenem w env (lokalny przebieg bez builda) — chunki powstają dopiero
  // przy pierwszym żądaniu, więc zamiast skanu jawna deklaracja.
  if (process.env.E2E_CF_TOKEN_IN_SERVER === '1') return true;
  const dir = join(root, '.next', 'static', 'chunks');
  if (!existsSync(dir)) return false;
  const pending = [dir];
  while (pending.length > 0) {
    const current = pending.pop()!;
    for (const name of readdirSync(current)) {
      const file = join(current, name);
      if (statSync(file).isDirectory()) pending.push(file);
      else if (name.endsWith('.js') && readFileSync(file, 'utf-8').includes(E2E_CF_ANALYTICS_TOKEN)) {
        return true;
      }
    }
  }
  return false;
}

export interface AnalyticsSeen {
  /** Pobrania skryptu beaconu. */
  script: string[];
  /** Wysyłki danych do Cloudflare (poza skryptem). */
  rum: string[];
  /** Żądania do dawnych trackerów GA/Meta. */
  legacy: string[];
}

/**
 * Przechwytuje statystykę. Skrypt beaconu zastępuje atrapa, która tylko wystawia
 * `window.__cfBeaconSend()` — wysyła przez `navigator.sendBeacon` jak prawdziwy beacon, więc
 * test może sprawdzić bramkę po wycofaniu zgody. Nic nie wychodzi do Cloudflare/Google/Meta.
 */
export async function watchAnalytics(page: Page): Promise<AnalyticsSeen> {
  const seen: AnalyticsSeen = { script: [], rum: [], legacy: [] };
  await page.route(LEGACY_TRACKER_URL, async (route) => {
    seen.legacy.push(route.request().url());
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
  });
  await page.route(CF_URL, async (route) => {
    const url = route.request().url();
    if (url.includes('static.cloudflareinsights.com')) {
      seen.script.push(url);
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: "window.__cfBeaconSend = function () { return navigator.sendBeacon('https://cloudflareinsights.com/cdn-cgi/rum', '{}'); };",
      });
      return;
    }
    seen.rum.push(url);
    await route.fulfill({ status: 204, body: '' });
  });
  return seen;
}

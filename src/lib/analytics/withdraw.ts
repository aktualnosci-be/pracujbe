/**
 * Wycofanie zgody na analitykę przy załadowanym beaconie Cloudflare Web Analytics (#642).
 *
 * Dostawca nie ma API do zatrzymania już wykonanego skryptu (brak odpowiednika „revoke”),
 * a `next/script` nie usuwa go z DOM ani nie odpina jego nasłuchów (np. wysyłki pomiarów przy
 * `pagehide`/`visibilitychange`). Dlatego wycofanie zgody w tej samej karcie:
 *
 *  1. od razu odcina ruch do dostawcy w bieżącym dokumencie — polityka CSP `connect-src 'self'`
 *     dołożona w `<meta>` (obejmuje `sendBeacon`, `fetch` i XHR, także gdy skrypt trzyma
 *     własne referencje do tych funkcji) oraz, zapasowo, nakładka na `navigator.sendBeacon`
 *     (główna droga wysyłki beaconu) odrzucająca adresy hostów Cloudflare Insights;
 *  2. zostawia znacznik w `sessionStorage`, żeby po przeładowaniu pokazać komunikat;
 *  3. czeka (najwyżej `PERSIST_WAIT_MS`) na zapis zgody w serwerowym logu i przeładowuje
 *     stronę — nowy dokument nie ma skryptu (cookie ma już `analytics: false`).
 *
 * Każde wywołanie jest bezpieczne przy braku `window` (SSR) i idempotentne.
 */

import { markWithdrawnNotice } from './withdraw-flag';

export { WITHDRAWN_NOTICE_KEY, takeWithdrawnNotice } from './withdraw-flag';

/** Hosty dostawcy: skrypt (`static.`) i odbiornik pomiarów (`cloudflareinsights.com/cdn-cgi/rum`). */
export function isBeaconHost(url: string | URL, base?: string): boolean {
  let host: string;
  try {
    host = new URL(String(url), base).hostname.toLowerCase();
  } catch {
    return false;
  }
  return host === 'cloudflareinsights.com' || host.endsWith('.cloudflareinsights.com');
}

/** Maksymalny czas oczekiwania na zapis zgody w logu serwerowym przed przeładowaniem. */
export const PERSIST_WAIT_MS = 3_000;

const BLOCK_META_ID = 'pracujbe-analytics-withdrawn-csp';

type BlockableWindow = Window & typeof globalThis & { __pracujbeBeaconBlocked?: boolean };

/** Odcina w bieżącym dokumencie każdą drogę wysyłki do Cloudflare Insights (idempotentnie). */
export function blockBeaconTraffic(win: Window = window): void {
  const w = win as BlockableWindow;
  if (w.__pracujbeBeaconBlocked) return;
  w.__pracujbeBeaconBlocked = true;
  const base = w.location?.href;

  const doc = w.document;
  if (doc?.head && !doc.getElementById(BLOCK_META_ID)) {
    const meta = doc.createElement('meta');
    meta.id = BLOCK_META_ID;
    meta.httpEquiv = 'Content-Security-Policy';
    meta.content = "connect-src 'self'";
    doc.head.appendChild(meta);
  }

  const nav = w.navigator as Navigator | undefined;
  if (nav && typeof nav.sendBeacon === 'function') {
    const original = nav.sendBeacon.bind(nav);
    const guarded = (url: string | URL, data?: BodyInit | null) =>
      isBeaconHost(url, base) ? false : original(url, data);
    try {
      Object.defineProperty(nav, 'sendBeacon', { configurable: true, writable: true, value: guarded });
    } catch {
      // nawigator zamrożony — zostaje polityka CSP z <meta>
    }
  }
}

/**
 * Pełna ścieżka wycofania przy załadowanym beaconie: blokada ruchu → znacznik komunikatu →
 * (zapis zgody albo limit czasu) → przeładowanie strony.
 */
export async function withdrawLoadedBeacon(
  pending: Promise<unknown>,
  win: Window = window,
  waitMs: number = PERSIST_WAIT_MS,
): Promise<void> {
  blockBeaconTraffic(win);
  markWithdrawnNotice(win);
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    pending.catch(() => undefined),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, waitMs);
    }),
  ]);
  if (timer !== undefined) clearTimeout(timer);
  win.location.reload();
}

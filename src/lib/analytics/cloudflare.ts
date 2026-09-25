import { getConsent } from '@/lib/consent-cookie';

import { allowsTrackingOnPath } from './route-policy';

/**
 * Cloudflare Web Analytics (#570, decyzja właściciela 25.09.2026) — jedyna statystyka odwiedzin.
 * Beacon nie ustawia cookies ani identyfikatorów; mimo to ładujemy go dopiero po zgodzie
 * w kategorii analitycznej (Invariant #7, ten sam wybór co lejek ofert #575).
 *
 * Token jest publiczny (wklejany do bundla, `NEXT_PUBLIC_CF_ANALYTICS_TOKEN`); brak albo zły
 * format = beacon się nie ładuje.
 */

export const CF_BEACON_SRC = 'https://static.cloudflareinsights.com/beacon.min.js';

/** Hosty w CSP: skrypt beaconu i adres zbierania danych. */
export const CF_SCRIPT_HOST = 'https://static.cloudflareinsights.com';
export const CF_CONNECT_HOST = 'https://cloudflareinsights.com';

const TOKEN = /^[0-9a-f]{32}$/i;

/** Token beaconu z env albo `null` (brak/niepoprawny — nic się nie ładuje). */
export function cloudflareAnalyticsToken(
  raw: string | undefined = process.env.NEXT_PUBLIC_CF_ANALYTICS_TOKEN,
): string | null {
  const value = raw?.trim();
  return value && TOKEN.test(value) ? value.toLowerCase() : null;
}

/** Wartość atrybutu `data-cf-beacon` (JSON bez danych spoza tokenu). */
export function cloudflareBeaconConfig(token: string): string {
  return JSON.stringify({ token, spa: true });
}

/** Zgoda analityczna na bieżącej stronie — czytana z cookie w chwili sprawdzenia. */
export function analyticsAllowedNow(): boolean {
  if (typeof window === 'undefined') return false;
  if (!allowsTrackingOnPath(window.location.pathname)) return false;
  return getConsent()?.categories.analytics === true;
}

/** Czy adres to wysyłka danych beaconu (Cloudflare lub `/cdn-cgi/rum` przez proxy strony). */
export function isCloudflareBeaconUrl(url: string | URL): boolean {
  let parsed: URL;
  try {
    parsed = new URL(String(url), typeof location !== 'undefined' ? location.href : 'http://localhost');
  } catch {
    return false;
  }
  const host = parsed.hostname;
  return (
    host === 'cloudflareinsights.com' ||
    host.endsWith('.cloudflareinsights.com') ||
    parsed.pathname === '/cdn-cgi/rum' ||
    parsed.pathname.startsWith('/cdn-cgi/rum/')
  );
}

let guardInstalled = false;

/**
 * Bramka wycofania: raz załadowany skrypt beaconu zostaje w karcie (nie da się go „wyładować”),
 * więc wysyłki do Cloudflare przechodzą przez sprawdzenie zgody w chwili wysyłki. Po wycofaniu
 * (w tej albo w innej karcie) i na trasach prywatnych `sendBeacon`/`fetch`/XHR do beaconu są
 * pomijane. Dotyczy wyłącznie adresów beaconu; idempotentne.
 */
export function installCloudflareBeaconGuard(): void {
  if (guardInstalled || typeof window === 'undefined') return;
  guardInstalled = true;

  const nav = window.navigator as Navigator & { sendBeacon?: Navigator['sendBeacon'] };
  if (typeof nav.sendBeacon === 'function') {
    const original = nav.sendBeacon.bind(nav);
    nav.sendBeacon = (url: string | URL, data?: BodyInit | null) =>
      isCloudflareBeaconUrl(url) && !analyticsAllowedNow() ? false : original(url, data);
  }

  if (typeof window.fetch === 'function') {
    const original = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' || input instanceof URL ? input : input.url;
      if (isCloudflareBeaconUrl(url) && !analyticsAllowedNow()) {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return original(input, init);
    };
  }

  if (typeof XMLHttpRequest !== 'undefined') {
    const blocked = new WeakSet<XMLHttpRequest>();
    const open = XMLHttpRequest.prototype.open;
    const send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function patchedOpen(
      this: XMLHttpRequest,
      ...args: Parameters<XMLHttpRequest['open']>
    ) {
      if (isCloudflareBeaconUrl(args[1]) && !analyticsAllowedNow()) blocked.add(this);
      else blocked.delete(this);
      return (open as (...a: unknown[]) => void).apply(this, args);
    } as XMLHttpRequest['open'];
    XMLHttpRequest.prototype.send = function patchedSend(this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
      if (blocked.has(this)) return;
      return send.call(this, body);
    };
  }
}

/** Tylko do testów: pozwala zainstalować bramkę ponownie po podmianie globali. */
export function resetCloudflareBeaconGuardForTests(): void {
  guardInstalled = false;
}

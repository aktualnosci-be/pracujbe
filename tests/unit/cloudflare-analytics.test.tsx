import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * #570 — Cloudflare Web Analytics zamiast GA i Meta Pixel (decyzja właściciela 25.09.2026):
 * - beacon ładuje się tylko z poprawnym tokenem, po zgodzie analitycznej i poza trasami
 *   prywatnymi (Invariant #7);
 * - po wycofaniu zgody (także w innej karcie — samo cookie) bramka blokuje wysyłki
 *   załadowanego skryptu; kontrola ujemna: bez bramki ta sama wysyłka przechodzi;
 * - CSP: host beaconu zamiast hostów Google/Meta; w kodzie brak GA/Meta Pixel.
 */

const TOKEN = '0123456789abcdef0123456789abcdef';
const { recordConsent } = vi.hoisted(() => ({ recordConsent: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/actions/consent', () => ({ recordConsent }));

let pathname = '/pl/oferty-pracy';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));

function writeConsent(analytics: boolean, version = '2.0') {
  const record = {
    v: version,
    categories: { necessary: true, preferences: false, analytics, marketing: false },
    ts: '2026-09-25T00:00:00.000Z',
    id: 'cf-test',
  };
  document.cookie = `pracujbe_consent=${encodeURIComponent(JSON.stringify(record))}; Path=/`;
}

function clearCookies() {
  for (const entry of document.cookie ? document.cookie.split('; ') : []) {
    document.cookie = `${entry.split('=')[0]}=; Max-Age=0; Path=/`;
  }
}

function beaconScript(): HTMLScriptElement | null {
  return document.querySelector('script[src="https://static.cloudflareinsights.com/beacon.min.js"]');
}

async function loadAnalytics(token: string | undefined) {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_CONSENT_POLICY_VERSION', '2.0');
  if (token === undefined) vi.stubEnv('NEXT_PUBLIC_CF_ANALYTICS_TOKEN', '');
  else vi.stubEnv('NEXT_PUBLIC_CF_ANALYTICS_TOKEN', token);
  const mod = await import('@/components/cookies/Analytics');
  const store = await import('@/lib/consent-store');
  return { Analytics: mod.Analytics, store };
}

beforeEach(() => {
  pathname = '/pl/oferty-pracy';
  clearCookies();
  for (const s of document.querySelectorAll('script')) s.remove();
});

afterEach(() => {
  cleanup();
  clearCookies();
  vi.unstubAllEnvs();
});

describe('token beaconu', () => {
  it('tylko 32 znaki hex; inaczej null', async () => {
    const { cloudflareAnalyticsToken, cloudflareBeaconConfig } = await import('@/lib/analytics/cloudflare');
    expect(cloudflareAnalyticsToken(TOKEN)).toBe(TOKEN);
    expect(cloudflareAnalyticsToken(` ${TOKEN.toUpperCase()} `)).toBe(TOKEN);
    for (const bad of [undefined, '', 'abc', `${TOKEN}0`, '"}<script>', 'G-TEST000000']) {
      expect(cloudflareAnalyticsToken(bad)).toBeNull();
    }
    expect(JSON.parse(cloudflareBeaconConfig(TOKEN))).toEqual({ token: TOKEN, spa: true });
  });
});

describe('<Analytics/> — beacon tylko po zgodzie', () => {
  it('bez decyzji i po „Tylko niezbędne” — brak skryptu', async () => {
    const { Analytics, store } = await loadAnalytics(TOKEN);
    const { consent } = { consent: await import('@/lib/consent') };
    render(<Analytics />);
    await act(async () => {});
    expect(beaconScript()).toBeNull();
    act(() => {
      store.updateConsent(consent.necessaryOnly(), 'cookie_banner');
    });
    await act(async () => {});
    expect(beaconScript()).toBeNull();
  });

  it('zgoda analityczna → jeden skrypt z tokenem (kontrola ujemna obserwatora)', async () => {
    const { Analytics, store } = await loadAnalytics(TOKEN);
    const consent = await import('@/lib/consent');
    render(<Analytics />);
    act(() => {
      store.updateConsent(consent.acceptAllCategories(), 'cookie_banner');
    });
    await act(async () => {});
    await act(async () => {});
    const script = beaconScript();
    expect(script).not.toBeNull();
    expect(JSON.parse(script!.getAttribute('data-cf-beacon') ?? '{}')).toEqual({ token: TOKEN, spa: true });
    expect(document.querySelectorAll('script[src*="cloudflareinsights"]')).toHaveLength(1);
  });

  it('zapisana zgoda, ale brak tokenu → nic się nie ładuje', async () => {
    writeConsent(true);
    const { Analytics } = await loadAnalytics(undefined);
    render(<Analytics />);
    await act(async () => {});
    await act(async () => {});
    expect(beaconScript()).toBeNull();
  });

  it('trasa prywatna (panel) → brak skryptu mimo zgody', async () => {
    writeConsent(true);
    pathname = '/pl/candidate';
    const { Analytics } = await loadAnalytics(TOKEN);
    render(<Analytics />);
    await act(async () => {});
    await act(async () => {});
    expect(beaconScript()).toBeNull();
  });

  it('stara wersja polityki (1.0) → brak skryptu', async () => {
    writeConsent(true, '1.0');
    const { Analytics } = await loadAnalytics(TOKEN);
    render(<Analytics />);
    await act(async () => {});
    await act(async () => {});
    expect(beaconScript()).toBeNull();
  });
});

describe('bramka wysyłki po wycofaniu', () => {
  const CF_URL = 'https://cloudflareinsights.com/cdn-cgi/rum';

  async function guarded() {
    vi.resetModules();
    const sent: string[] = [];
    const sendBeacon = vi.fn((url: string | URL) => {
      sent.push(String(url));
      return true;
    });
    Object.defineProperty(window.navigator, 'sendBeacon', { configurable: true, writable: true, value: sendBeacon });
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const cf = await import('@/lib/analytics/cloudflare');
    return { cf, sendBeacon, fetchMock };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('ze zgodą wysyłka przechodzi; po wycofaniu w innej karcie (samo cookie) — zablokowana', async () => {
    const { cf, sendBeacon, fetchMock } = await guarded();
    writeConsent(true);
    cf.installCloudflareBeaconGuard();
    expect(navigator.sendBeacon(CF_URL, '{}')).toBe(true);
    await window.fetch(CF_URL, { method: 'POST' });
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    writeConsent(false);
    expect(navigator.sendBeacon(CF_URL, '{}')).toBe(false);
    expect(navigator.sendBeacon('/cdn-cgi/rum', '{}')).toBe(false);
    expect((await window.fetch(CF_URL, { method: 'POST' })).status).toBe(204);
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('inne adresy przechodzą bez względu na zgodę', async () => {
    const { cf, sendBeacon, fetchMock } = await guarded();
    writeConsent(false);
    cf.installCloudflareBeaconGuard();
    navigator.sendBeacon('/api/csp-report', '{}');
    await window.fetch('/api/job-funnel', { method: 'POST' });
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('XHR do beaconu po wycofaniu nie jest wysyłany', async () => {
    const { cf } = await guarded();
    const sendSpy = vi.spyOn(XMLHttpRequest.prototype, 'send').mockImplementation(() => undefined);
    cf.installCloudflareBeaconGuard();
    writeConsent(false);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', CF_URL);
    xhr.send('{}');
    expect(sendSpy).not.toHaveBeenCalled();
    sendSpy.mockRestore();
  });

  it('kontrola ujemna: bez bramki wysyłka po wycofaniu przechodzi', async () => {
    const { sendBeacon } = await guarded();
    writeConsent(false);
    navigator.sendBeacon(CF_URL, '{}');
    expect(sendBeacon).toHaveBeenCalledTimes(1);
  });

  it('rozpoznaje adresy beaconu', async () => {
    const { cf } = await guarded();
    expect(cf.isCloudflareBeaconUrl(CF_URL)).toBe(true);
    expect(cf.isCloudflareBeaconUrl('https://static.cloudflareinsights.com/beacon.min.js')).toBe(true);
    expect(cf.isCloudflareBeaconUrl('/cdn-cgi/rum?x=1')).toBe(true);
    expect(cf.isCloudflareBeaconUrl('https://example.com/cdn-cgi/rumble')).toBe(false);
    expect(cf.isCloudflareBeaconUrl('https://evilcloudflareinsights.com/')).toBe(false);
    expect(cf.isCloudflareBeaconUrl('/api/job-funnel')).toBe(false);
  });
});

describe('brak GA/Meta Pixel w kodzie i CSP (#570)', () => {
  const root = process.cwd();
  const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

  it('CSP: beacon Cloudflare zamiast hostów Google/Meta', () => {
    const config = read('next.config.mjs');
    expect(config).toMatch(/script-src[^\n]*https:\/\/static\.cloudflareinsights\.com/);
    expect(config).toMatch(/connect-src[^\n]*https:\/\/cloudflareinsights\.com/);
    expect(config).not.toMatch(/googletagmanager|google-analytics\.com|facebook\.(net|com)/);
  });

  it('komponent i store nie odwołują się do GA/Meta', () => {
    for (const file of ['src/components/cookies/Analytics.tsx', 'src/lib/consent-store.ts', 'src/lib/consent.ts', 'src/lib/consent-cookie.ts']) {
      const code = read(file);
      expect(code, file).not.toMatch(/NEXT_PUBLIC_GA_MEASUREMENT_ID|NEXT_PUBLIC_META_PIXEL_ID|gtag\(|fbq\(|googletagmanager|fbevents/);
    }
  });

  it('domyślna wersja polityki cookies to 2.0', () => {
    expect(read('src/lib/consent-cookie.ts')).toMatch(/NEXT_PUBLIC_CONSENT_POLICY_VERSION \?\? '2\.0'/);
  });
});

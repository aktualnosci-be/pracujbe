import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * #349 — Invariant #7 (zero trackingu przed zgodą) na poziomie logiki zgód: wycofanie zgody
 * (`syncTrackers`), unieważnienie starej wersji polityki i uszkodzonego cookie (`getConsent`)
 * oraz rozgłaszanie zmiany (`updateConsent`).
 */

const GA_ID = 'G-UNIT000000';
const { recordConsent } = vi.hoisted(() => ({ recordConsent: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/actions/consent', () => ({ recordConsent }));

let consent: typeof import('@/lib/consent');
let store: typeof import('@/lib/consent-store');

beforeAll(async () => {
  // GA_ID i wersja polityki są czytane przy imporcie modułu (jak w bundlu klienta).
  vi.stubEnv('NEXT_PUBLIC_GA_MEASUREMENT_ID', GA_ID);
  vi.stubEnv('NEXT_PUBLIC_CONSENT_POLICY_VERSION', '2.0');
  consent = await import('@/lib/consent');
  store = await import('@/lib/consent-store');
});

function cookieNames(): string[] {
  return document.cookie ? document.cookie.split('; ').map((c) => c.split('=')[0]!) : [];
}

function clearAllCookies() {
  for (const name of cookieNames()) document.cookie = `${name}=; Max-Age=0; Path=/`;
}

function setConsentCookie(value: unknown) {
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  document.cookie = `pracujbe_consent=${encodeURIComponent(raw)}; Path=/`;
}

const w = window as unknown as Record<string, unknown> & { fbq?: unknown };

beforeEach(() => {
  clearAllCookies();
  delete w[`ga-disable-${GA_ID}`];
  delete w.fbq;
  recordConsent.mockClear();
});

afterEach(() => {
  clearAllCookies();
});

describe('syncTrackers — wycofanie zgody', () => {
  it('brak zgody: usuwa cookies GA i Meta, blokuje GA i odwołuje zgodę Pixela', () => {
    for (const name of ['_ga', '_ga_XYZ123', '_gid', '_gat_UA', '_fbp', '_fbc', 'pracujbe_visitor']) {
      document.cookie = `${name}=1; Path=/`;
    }
    const fbq = vi.fn();
    w.fbq = fbq;

    store.syncTrackers({ analytics: false, marketing: false });

    expect(cookieNames().sort()).toEqual(['pracujbe_visitor']);
    expect(w[`ga-disable-${GA_ID}`]).toBe(true);
    expect(fbq).toHaveBeenCalledWith('consent', 'revoke');
  });

  it('tylko analityka: cookies GA zostają, Meta czyszczona; flaga GA zdjęta', () => {
    w[`ga-disable-${GA_ID}`] = true;
    for (const name of ['_ga', '_fbp']) document.cookie = `${name}=1; Path=/`;
    const fbq = vi.fn();
    w.fbq = fbq;

    store.syncTrackers({ analytics: true, marketing: false });

    expect(cookieNames()).toEqual(['_ga']);
    expect(w[`ga-disable-${GA_ID}`]).toBe(false);
    expect(fbq).toHaveBeenCalledWith('consent', 'revoke');
  });

  it('tylko marketing: cookies Meta zostają, GA czyszczona i zablokowana, Pixel nieodwołany', () => {
    for (const name of ['_ga', '_fbp']) document.cookie = `${name}=1; Path=/`;
    const fbq = vi.fn();
    w.fbq = fbq;

    store.syncTrackers({ analytics: false, marketing: true });

    expect(cookieNames()).toEqual(['_fbp']);
    expect(w[`ga-disable-${GA_ID}`]).toBe(true);
    expect(fbq).not.toHaveBeenCalledWith('consent', 'revoke');
  });

  it('ponowna zgoda na marketing po wycofaniu przywraca Pixel (grant), a GA odblokowuje', () => {
    const fbq = vi.fn();
    w.fbq = fbq;

    store.syncTrackers({ analytics: false, marketing: false });
    store.syncTrackers({ analytics: true, marketing: true });

    expect(fbq.mock.calls).toEqual([
      ['consent', 'revoke'],
      ['consent', 'grant'],
    ]);
    expect(w[`ga-disable-${GA_ID}`]).toBe(false);
  });
});

describe('getConsent — tylko ważna zgoda w bieżącej wersji polityki', () => {
  const valid = {
    v: '2.0',
    categories: { necessary: true, preferences: false, analytics: true, marketing: false },
    ts: '2026-09-01T00:00:00.000Z',
    id: 'c1',
  };

  it('bieżąca wersja → rekord', () => {
    setConsentCookie(valid);
    expect(consent.getConsent()).toMatchObject({ v: '2.0', categories: { analytics: true } });
    expect(consent.hasConsent('analytics')).toBe(true);
  });

  it('inna wersja polityki → null (baner wraca, trackery nieaktywne)', () => {
    setConsentCookie({ ...valid, v: '1.0' });
    expect(consent.getConsent()).toBeNull();
    expect(consent.hasConsent('analytics')).toBe(false);
  });

  it.each([
    ['uszkodzony JSON', '{"v":"2.0",'],
    ['nie obiekt', '"tak"'],
    ['brak kategorii', JSON.stringify({ v: '2.0', ts: 'x', id: 'y' })],
    ['brak id', JSON.stringify({ v: '2.0', ts: 'x', categories: {} })],
  ])('%s → null', (_label, raw) => {
    setConsentCookie(raw);
    expect(consent.getConsent()).toBeNull();
  });

  it('wartości spoza `true` nie dają zgody (np. "true" jako tekst)', () => {
    setConsentCookie({ ...valid, categories: { analytics: 'true', marketing: 1 } });
    expect(consent.getConsent()?.categories).toEqual({
      necessary: true,
      preferences: false,
      analytics: false,
      marketing: false,
    });
  });

  it('necessary zawsze aktywne, nawet bez żadnej zgody', () => {
    expect(consent.getConsent()).toBeNull();
    expect(consent.hasConsent('necessary')).toBe(true);
    expect(consent.hasConsent('marketing')).toBe(false);
  });
});

describe('saveConsent / updateConsent', () => {
  it('cookie zapisane z wersją polityki i czasem życia 180 dni; log serwerowy z kategoriami i źródłem', () => {
    const cookieSetter = vi.spyOn(document, 'cookie', 'set');
    consent.saveConsent(consent.necessaryOnly(), 'cookie_settings');

    const written = cookieSetter.mock.calls.map(([v]) => v).find((v) => v.startsWith('pracujbe_consent='));
    cookieSetter.mockRestore();
    expect(written).toContain(`Max-Age=${180 * 24 * 60 * 60}`);
    expect(consent.getConsent()).toMatchObject({ v: '2.0' });
    expect(recordConsent).toHaveBeenCalledWith(
      { necessary: true, preferences: false, analytics: false, marketing: false },
      'cookie_settings',
    );
  });

  it('błąd logu serwerowego nie przerywa zapisu zgody w przeglądarce', async () => {
    recordConsent.mockRejectedValueOnce(new Error('offline'));
    expect(() => consent.saveConsent(consent.acceptAllCategories())).not.toThrow();
    await Promise.resolve();
    expect(consent.getConsent()?.categories.marketing).toBe(true);
  });

  it('updateConsent: powiadamia subskrybentów, emituje zdarzenie DOM i od razu wycofuje trackery', () => {
    document.cookie = '_ga=1; Path=/';
    const listener = vi.fn();
    const unsubscribe = store.subscribeConsent(listener);
    const onEvent = vi.fn();
    window.addEventListener(store.CONSENT_CHANGE_EVENT, onEvent);

    const record = store.updateConsent({ ...consent.acceptAllCategories(), analytics: false });

    expect(listener).toHaveBeenCalledWith(record);
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect((onEvent.mock.calls[0]![0] as CustomEvent).detail).toEqual(record);
    expect(cookieNames()).not.toContain('_ga');
    expect(w[`ga-disable-${GA_ID}`]).toBe(true);

    unsubscribe();
    window.removeEventListener(store.CONSENT_CHANGE_EVENT, onEvent);
    store.updateConsent(consent.necessaryOnly());
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

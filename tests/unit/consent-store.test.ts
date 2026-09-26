import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * #349/#570 — Invariant #7 (zero trackingu przed zgodą) na poziomie logiki zgód: rozgłaszanie
 * zmiany zgody (`updateConsent`), unieważnienie starej wersji polityki i uszkodzonego cookie
 * (`getConsent`). Cloudflare Web Analytics (beacon bezcookie'owy) zastąpił GA/Meta Pixel — nie
 * ma już cookies trackerów do czyszczenia; wycofanie egzekwuje samo (nie)renderowanie skryptu
 * w <Analytics/>, testowane przez E2E (`cookie-consent-categories.spec.ts`).
 */

const { recordConsent } = vi.hoisted(() => ({ recordConsent: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/actions/consent', () => ({ recordConsent }));

let consent: typeof import('@/lib/consent');
let store: typeof import('@/lib/consent-store');

beforeAll(async () => {
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

beforeEach(() => {
  clearAllCookies();
  recordConsent.mockClear();
});

afterEach(() => {
  clearAllCookies();
});

describe('getConsent — tylko ważna zgoda w bieżącej wersji polityki', () => {
  const valid = {
    v: '2.0',
    categories: { necessary: true, preferences: false, analytics: true },
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

  it('cookie sprzed #570 (wersja 1.0 z kategorią marketing) → nieaktualne, baner wraca', () => {
    setConsentCookie({
      v: '1.0',
      categories: { necessary: true, preferences: true, analytics: true, marketing: true },
      ts: '2026-09-01T00:00:00.000Z',
      id: 'c-old',
    });
    expect(consent.getConsent()).toBeNull();
    expect(consent.hasConsent('analytics')).toBe(false);
  });

  it('klucz marketing w bieżącej wersji jest ignorowany (nie ma takiej kategorii)', () => {
    setConsentCookie({ ...valid, categories: { ...valid.categories, marketing: true } });
    expect(consent.getConsent()?.categories).toEqual(valid.categories);
  });

  it('kategorie banera: necessary, preferences, analytics (bez marketing, #570)', () => {
    expect([...consent.CONSENT_CATEGORIES]).toEqual(['necessary', 'preferences', 'analytics']);
    expect(Object.keys(consent.acceptAllCategories())).not.toContain('marketing');
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
    });
  });

  it('necessary zawsze aktywne, nawet bez żadnej zgody', () => {
    expect(consent.getConsent()).toBeNull();
    expect(consent.hasConsent('necessary')).toBe(true);
  });

  it('uszkodzona sekwencja procentowa (URIError) → null, bez rzucania (#613)', () => {
    // `setConsentCookie` zawsze koduje przez encodeURIComponent — tu ustawiamy wartość
    // wprost, żeby odtworzyć realnie uszkodzone/spreparowane cookie (niedokończone `%`).
    document.cookie = 'pracujbe_consent=%E0%A4%A; Path=/';
    expect(() => consent.getConsent()).not.toThrow();
    expect(consent.getConsent()).toBeNull();
    expect(() => consent.hasConsent('analytics')).not.toThrow();
    expect(consent.hasConsent('analytics')).toBe(false);
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
      { necessary: true, preferences: false, analytics: false },
      'cookie_settings',
      '2.0',
    );
  });

  it('błąd logu serwerowego nie przerywa zapisu zgody w przeglądarce', async () => {
    recordConsent.mockRejectedValueOnce(new Error('offline'));
    expect(() => consent.saveConsent(consent.acceptAllCategories())).not.toThrow();
    await Promise.resolve();
    expect(consent.getConsent()?.categories).toEqual({ necessary: true, preferences: true, analytics: true });
  });

  it('updateConsent: powiadamia subskrybentów i emituje zdarzenie DOM (bez reloadu)', () => {
    const listener = vi.fn();
    const unsubscribe = store.subscribeConsent(listener);
    const onEvent = vi.fn();
    window.addEventListener(store.CONSENT_CHANGE_EVENT, onEvent);

    const record = store.updateConsent({ ...consent.acceptAllCategories(), analytics: false });

    expect(listener).toHaveBeenCalledWith(record);
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect((onEvent.mock.calls[0]![0] as CustomEvent).detail).toEqual(record);
    expect(record.categories.analytics).toBe(false);

    unsubscribe();
    window.removeEventListener(store.CONSENT_CHANGE_EVENT, onEvent);
    store.updateConsent(consent.necessaryOnly());
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

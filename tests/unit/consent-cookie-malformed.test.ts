import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * #613 — uszkodzone cookie zgody (niedokończona sekwencja procentowa) nie może rzucać
 * `URIError` z odczytu zgody: traktujemy je jak brak zgody (baner, zero trackingu — Inv. #7),
 * a strona zostaje używalna (Inv. #8).
 */

const { recordConsent } = vi.hoisted(() => ({ recordConsent: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/actions/consent', () => ({ recordConsent }));

let consent: typeof import('@/lib/consent');
let store: typeof import('@/lib/consent-store');

const MALFORMED = ['%E0%A4%A', '%', '%ZZ', '%7B%22v%22%3A%222.0%22%E0'];

beforeAll(async () => {
  vi.stubEnv('NEXT_PUBLIC_CONSENT_POLICY_VERSION', '2.0');
  consent = await import('@/lib/consent');
  store = await import('@/lib/consent-store');
});

afterEach(() => {
  document.cookie = 'pracujbe_consent=; Max-Age=0; Path=/';
});

describe('odczyt zgody z uszkodzonego cookie (#613)', () => {
  it('kontrola ujemna: próbki naprawdę rzucają URIError przy naiwnym dekodowaniu', () => {
    for (const raw of MALFORMED) {
      expect(() => decodeURIComponent(raw), raw).toThrow(URIError);
    }
  });

  it.each(MALFORMED)('%s → brak zgody, bez wyjątku', (raw) => {
    document.cookie = `pracujbe_consent=${raw}; Path=/`;
    expect(() => consent.getConsent()).not.toThrow();
    expect(consent.getConsent()).toBeNull();
    expect(consent.hasConsent('analytics')).toBe(false);
    expect(consent.hasConsent('marketing')).toBe(false);
    expect(() => store.getConsentSnapshot()).not.toThrow();
    expect(store.getConsentSnapshot()).toBeNull();
  });

  it('poprawna zgoda zapisana po uszkodzonej wartości jest czytana normalnie', () => {
    document.cookie = 'pracujbe_consent=%E0%A4%A; Path=/';
    consent.saveConsent({ necessary: true, preferences: false, analytics: true, marketing: false }, 'cookie_banner');
    expect(consent.hasConsent('analytics')).toBe(true);
    expect(consent.hasConsent('marketing')).toBe(false);
  });
});

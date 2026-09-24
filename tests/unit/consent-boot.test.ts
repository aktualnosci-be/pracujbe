import { afterEach, describe, expect, it } from 'vitest';

import { CONSENT_COOKIE_NAME, CONSENT_POLICY_VERSION, getConsent } from '@/lib/consent';
import { CONSENT_BOOT_ATTRIBUTE, consentBootScript } from '@/lib/consent-boot';

/**
 * #389 — skrypt z <head> ukrywa baner renderowany na serwerze tylko przy ważnej zgodzie.
 * Warunki muszą być te same co w `getConsent()`: inaczej baner zniknąłby bez zgody
 * (CookieConsent i tak usuwa wtedy atrybut po hydratacji) albo mignąłby przy ważnej zgodzie.
 */

function setCookie(value: string) {
  document.cookie = `${CONSENT_COOKIE_NAME}=${value}; Path=/`;
}

function runBoot(): string | null {
  document.documentElement.removeAttribute(CONSENT_BOOT_ATTRIBUTE);
  new Function(consentBootScript())();
  return document.documentElement.getAttribute(CONSENT_BOOT_ATTRIBUTE);
}

const valid = {
  v: CONSENT_POLICY_VERSION,
  categories: { necessary: true, preferences: false, analytics: false, marketing: false },
  ts: '2026-01-01T00:00:00.000Z',
  id: 'boot-test',
};

afterEach(() => {
  document.cookie = `${CONSENT_COOKIE_NAME}=; Max-Age=0; Path=/`;
  document.documentElement.removeAttribute(CONSENT_BOOT_ATTRIBUTE);
});

describe('consentBootScript', () => {
  it('bez cookie zgody nie ustawia atrybutu (baner widoczny)', () => {
    expect(runBoot()).toBeNull();
  });

  it.each([
    ['zakodowane (saveConsent)', encodeURIComponent(JSON.stringify(valid))],
    ['surowy JSON', JSON.stringify(valid)],
  ])('ważna zgoda — %s → data-consent="set"', (_label, value) => {
    setCookie(value);
    expect(getConsent()).not.toBeNull();
    expect(runBoot()).toBe('set');
  });

  it.each([
    ['inna wersja polityki', { ...valid, v: `${CONSENT_POLICY_VERSION}-old` }],
    ['brak id', { ...valid, id: undefined }],
    ['brak ts', { ...valid, ts: 1 }],
    ['brak kategorii', { ...valid, categories: null }],
  ])('%s → atrybut nieustawiony, zgodnie z getConsent()', (_label, record) => {
    setCookie(encodeURIComponent(JSON.stringify(record)));
    expect(getConsent()).toBeNull();
    expect(runBoot()).toBeNull();
  });

  it('niepoprawny JSON nie rzuca i nie ukrywa banera', () => {
    setCookie('%7Bnie-json');
    expect(runBoot()).toBeNull();
  });

  it('tylko czyta cookie — niczego nie zapisuje ani nie ładuje (Invariant #7)', () => {
    const script = consentBootScript();
    expect(script).not.toMatch(/document\.cookie\s*=/);
    expect(script).not.toMatch(/createElement|fetch|XMLHttpRequest|sendBeacon|localStorage/);
  });
});

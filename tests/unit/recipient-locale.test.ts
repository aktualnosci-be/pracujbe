import { describe, expect, it } from 'vitest';

import { resolveRecipientLocale } from '@/lib/i18n/recipient-locale';

/**
 * Testy wyboru języka odbiorcy powiadomień/e-maili.
 *
 * Kolejność fallbacku: preferred_locale -> account_locale -> signup_locale -> 'en'.
 * Akceptowane wyłącznie wartości z ['pl','nl','fr','en']; nieznane/puste są pomijane.
 * Zgodne z INVARIANT #1 (aplikacja działa bez env, funkcja jest czysta).
 */

describe('resolveRecipientLocale', () => {
  it('preferuje preferred_locale, gdy jest poprawne', () => {
    expect(
      resolveRecipientLocale({
        preferred_locale: 'nl',
        account_locale: 'fr',
        signup_locale: 'en',
      }),
    ).toBe('nl');
  });

  it('spada do account_locale, gdy preferred_locale jest puste/nieznane', () => {
    expect(
      resolveRecipientLocale({
        preferred_locale: null,
        account_locale: 'fr',
        signup_locale: 'en',
      }),
    ).toBe('fr');

    expect(
      resolveRecipientLocale({
        preferred_locale: 'de', // nieobsługiwane -> pomijane
        account_locale: 'nl',
        signup_locale: 'en',
      }),
    ).toBe('nl');
  });

  it('spada do signup_locale, gdy preferred i account są puste/nieznane', () => {
    expect(
      resolveRecipientLocale({
        preferred_locale: undefined,
        account_locale: null,
        signup_locale: 'pl',
      }),
    ).toBe('pl');

    expect(
      resolveRecipientLocale({
        preferred_locale: '', // puste -> pomijane
        account_locale: 'xx', // nieznane -> pomijane
        signup_locale: 'fr',
      }),
    ).toBe('fr');
  });

  it('zwraca "en" jako ostateczny fallback', () => {
    expect(resolveRecipientLocale({})).toBe('en');
    expect(
      resolveRecipientLocale({
        preferred_locale: null,
        account_locale: null,
        signup_locale: null,
      }),
    ).toBe('en');
  });

  it('ignoruje wszystkie niepoprawne wartości i zwraca "en"', () => {
    expect(
      resolveRecipientLocale({
        preferred_locale: 'de',
        account_locale: 'es',
        signup_locale: 'ro',
      }),
    ).toBe('en');

    expect(
      resolveRecipientLocale({
        preferred_locale: '  ', // niepusty, ale nie jest obsługiwanym locale
        account_locale: 'EN', // wielkość liter ma znaczenie -> nie pasuje
        signup_locale: 'polish',
      }),
    ).toBe('en');
  });

  it('akceptuje każdy z obsługiwanych języków (pl, nl, fr, en)', () => {
    for (const locale of ['pl', 'nl', 'fr', 'en'] as const) {
      expect(resolveRecipientLocale({ preferred_locale: locale })).toBe(locale);
    }
  });
});

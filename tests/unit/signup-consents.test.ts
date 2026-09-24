// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CONSENT_WORDING_KEYS,
  consentWordingVersion,
  consentWordingVersions,
  OPTIONAL_CONSENT_PURPOSES,
  signupOptionalConsents,
} from '@/lib/signup-consents';

/**
 * #493: każdy element formularza ma własną etykietę (i własną wersję treści w dowodzie),
 * a lista celów opcjonalnych jest lustrem allow-listy `record_signup_consents` z migracji.
 */

const LOCALES = ['pl', 'nl', 'fr', 'en'] as const;
const MIGRATION = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/0107_consent_separation.sql'),
  'utf8',
);

describe('wersje treści zgód', () => {
  it.each(LOCALES)('%s: rejestracja ma trzy różne wersje (regulamin, prywatność, marketing)', (locale) => {
    const versions = consentWordingVersions('signup', locale, OPTIONAL_CONSENT_PURPOSES);
    expect(Object.keys(versions).sort()).toEqual(['email_marketing', 'privacy', 'terms']);
    for (const value of Object.values(versions)) expect(value).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(new Set(Object.values(versions)).size).toBe(3);
  });

  it.each(LOCALES)('%s: onboarding bez zgód opcjonalnych — tylko regulamin i prywatność', (locale) => {
    expect(Object.keys(consentWordingVersions('onboarding', locale)).sort()).toEqual(['privacy', 'terms']);
  });

  it('każdy klucz etykiety istnieje we wszystkich językach; wersja zależy od języka', () => {
    for (const keys of Object.values(CONSENT_WORDING_KEYS)) {
      for (const key of Object.values(keys)) {
        const perLocale = LOCALES.map((locale) => consentWordingVersion(locale, key!));
        expect(perLocale.every(Boolean)).toBe(true);
        expect(new Set(perLocale).size).toBe(LOCALES.length);
      }
    }
    expect(consentWordingVersion('pl', 'auth.doesNotExist')).toBeNull();
  });

  it('wersja mieści się w formacie akceptowanym przez bazę (consent_wording_version)', () => {
    const version = consentWordingVersion('pl', 'auth.termsAcceptLinks')!;
    expect(version).toMatch(/^[a-z0-9]+:[A-Za-z0-9._-]{1,72}$/);
  });
});

describe('zgody opcjonalne', () => {
  it('niezaznaczone lub brak pola = odmowa; tylko true = zgoda', () => {
    expect(signupOptionalConsents({})).toEqual({ email_marketing: false });
    expect(signupOptionalConsents({ marketingOptIn: false })).toEqual({ email_marketing: false });
    expect(signupOptionalConsents({ marketingOptIn: true })).toEqual({ email_marketing: true });
  });

  it('lista celów = allow-lista RPC (0107); źródło signup w dzienniku #513', () => {
    expect(OPTIONAL_CONSENT_PURPOSES).toEqual(['email_marketing']);
    expect(MIGRATION).toContain(`where e.key <> '${OPTIONAL_CONSENT_PURPOSES[0]}'`);
    expect(MIGRATION).toContain("source in ('settings', 'unsubscribe_page', 'one_click', 'direct', 'signup')");
    // Bez własnej tabeli zgód opcjonalnych (#513 jest jedynym dziennikiem zgód e-mail).
    expect(MIGRATION).not.toMatch(/create table[^;]*optional_consents/i);
  });

  it('wersja treści ma dokładny format dziennika #513 (sha256 + 64 hex)', () => {
    for (const locale of LOCALES) {
      expect(consentWordingVersion(locale, 'auth.marketingOptIn')).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
  });
});

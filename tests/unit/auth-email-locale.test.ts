import { describe, expect, it } from 'vitest';

import type { Locale } from '@/i18n/routing';
import { renderEmail } from '@/emails/templates';
import { authEmailLocale, buildAuthEmail } from '@/lib/email/auth-email';

/** #291 — e-maile Auth: język wg INVARIANTU #1 (fallback 'en') i treść zgodna z akcją. */

describe('#291: język e-maila Auth', () => {
  it('brak profilu i metadanych → en (nie pl)', () => {
    expect(authEmailLocale(null, {})).toBe('en');
    expect(authEmailLocale(undefined, undefined)).toBe('en');
    expect(authEmailLocale(null, { locale: 'de' })).toBe('en');
  });

  it('profil nl → nl, nawet gdy rejestracja była po polsku', () => {
    expect(authEmailLocale({ preferred_locale: 'nl' }, { locale: 'pl' })).toBe('nl');
  });

  it('kolejność preferred → account → signup → metadane', () => {
    expect(authEmailLocale({ account_locale: 'fr', signup_locale: 'pl' }, { locale: 'en' })).toBe('fr');
    expect(authEmailLocale({ signup_locale: 'nl' }, { locale: 'fr' })).toBe('nl');
    expect(authEmailLocale({}, { locale: 'fr' })).toBe('fr');
  });
});

describe('#291: treść e-maila zgodna z typem akcji', () => {
  const LOCALES: readonly Locale[] = ['pl', 'nl', 'fr', 'en'];
  const signupBody = {
    pl: 'Dziękujemy za założenie konta',
    nl: 'Bedankt dat je een account hebt aangemaakt',
    fr: 'Merci d’avoir créé un compte',
    en: 'Thanks for creating an account',
  };
  const actions = [
    ['signup', 'accountConfirmation'],
    ['recovery', 'passwordReset'],
    ['magiclink', 'magicLink'],
    ['email_change', 'emailChange'],
    ['invite', 'invite'],
  ] as const;

  it.each(actions)('%s → %s', (action, type) => {
    expect(buildAuthEmail(action, 'https://x', undefined).type).toBe(type);
  });

  const cases = LOCALES.flatMap((locale) =>
    (['magiclink', 'email_change', 'invite'] as const).map((action) => ({ locale, action })),
  );

  it.each(cases)('$action / $locale: bez tekstu o założeniu konta, link w przycisku', async ({ locale, action }) => {
    const { type, data } = buildAuthEmail(action, 'https://auth.example/verify?t=1', 'Anna');
    const render = renderEmail as (
      t: typeof type,
      l: Locale,
      d: Record<string, unknown>,
    ) => Promise<{ subject: string; html: string }>;
    const { subject, html } = await render(type, locale, data);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(doc.body.textContent).not.toContain(signupBody[locale]);
    expect(subject.length).toBeGreaterThan(0);
    expect([...doc.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'))).toContain(
      'https://auth.example/verify?t=1',
    );
  });
});

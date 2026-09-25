import { describe, expect, it, vi } from 'vitest';

import type { Locale } from '@/i18n/routing';
import { renderEmail } from '@/emails/templates';
import { buildDeliveryData } from '@/lib/email/delivery-data';
import { emailPreferenceCategory, emailSendPool } from '@/lib/email/categories';

/**
 * #574 (0129) — ostrzeżenie przed usunięciem CV / konta z powodu braku aktywności: data
 * usunięcia z payloadu sformatowana w języku ODBIORCY (wiersz kolejki), CTA = logowanie
 * (logowanie tworzy sesję → last_seen_at → ostrzeżenie traci ważność). Bez kategorii
 * wypisania — to informacja o koncie, nie marketing.
 */

vi.mock('@/lib/env', () => ({ isProductionMode: vi.fn(() => false), env: { siteUrl: 'https://pracuj.be' } }));

const SITE = 'https://pracuj.be';
const LOCALES: readonly Locale[] = ['pl', 'nl', 'fr', 'en'];
const DATE = '2027-03-04T12:00:00+00:00';
const EXPECTED_DAY: Record<Locale, RegExp> = {
  pl: /4 marca 2027/,
  nl: /4 maart 2027/,
  fr: /4 mars 2027/,
  en: /4 March 2027/,
};

describe.each(['inactiveCvWarning', 'inactiveAccountWarning'] as const)('%s', (template) => {
  it.each(LOCALES)('%s: data usunięcia w języku odbiorcy, CTA do logowania', async (locale) => {
    const built = buildDeliveryData({ template, locale, payload: { deletionDate: DATE } }, SITE, 'Ola');
    expect(built.data['actionUrl']).toBe(`${SITE}/${locale}/logowanie`);
    const { html, subject, text } = await renderEmail(template, built.locale, built.data as never);
    expect(subject).toMatch(EXPECTED_DAY[locale]);
    expect(html).toMatch(EXPECTED_DAY[locale]);
    expect(text).toMatch(EXPECTED_DAY[locale]);
    expect(html).toContain(`${SITE}/${locale}/logowanie`);
    expect(html).toContain('Ola');
    expect(html).not.toContain('2027-03-04');
    expect(subject).not.toMatch(/\{\w+\}/);
    expect(html).not.toMatch(/\{\w+\}/);
  });

  it('bez kategorii wypisania, pula transakcyjna', () => {
    expect(emailPreferenceCategory(template)).toBeNull();
    expect(emailSendPool(template)).toBe('transactional');
  });

  it('kontrola ujemna: nieprawidłowa data nie trafia do treści jako surowa wartość', async () => {
    const built = buildDeliveryData({ template, locale: 'pl', payload: { deletionDate: 'jutro' } }, SITE);
    const { html, subject } = await renderEmail(template, built.locale, built.data as never);
    expect(html).not.toContain('jutro');
    expect(subject).not.toContain('jutro');
  });
});

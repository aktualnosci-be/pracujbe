import { describe, expect, it } from 'vitest';

import type { Locale } from '@/i18n/routing';
import { layoutCopy } from '@/emails/copy';
import { renderEmail } from '@/emails/templates';
import { buildDeliveryData, emailTargetPath } from '@/lib/email/delivery-data';

/**
 * #41 — potwierdzenie zgłoszenia treści w języku ZGŁASZAJĄCEGO (kolumna `locale` z bazy,
 * Invariant #1), z numerem sprawy, kodem dostępu i linkiem do statusu. Link niesie dane
 * sprawy we fragmencie `#`, a stopka nie twierdzi, że odbiorca ma konto.
 */

const SITE = 'https://pracuj.be';
const CASE = 'DSA-1A2B-3C4D-5E6F-7A8B';
const CODE = 'ABCDEFGHIJKLMNOPQRSTUVWX';
const LOCALES: readonly Locale[] = ['pl', 'nl', 'fr', 'en'];

describe('#41: e-mail reportReceived', () => {
  it.each(LOCALES)('%s: numer, kod, link do statusu w języku odbiorcy', async (locale) => {
    const built = buildDeliveryData(
      { template: 'reportReceived', locale, payload: { caseNumber: CASE, accessCode: CODE, targetType: 'job' } },
      SITE,
    );
    const { subject, html } = await renderEmail('reportReceived', built.locale, built.data as never);
    expect(subject).toContain(CASE);
    expect(html).toContain(CASE);
    expect(html).toContain(CODE);
    expect(html).toContain(`${SITE}/${locale}/zglos-tresc/sprawa#nr=${CASE}&amp;kod=${CODE}`);
    expect(html).toContain(`lang="${locale}"`);
    expect(html).not.toContain(layoutCopy[locale].footerNote);
    expect(subject).not.toMatch(/\{\w+\}/);
    expect(html).not.toMatch(/\{\w+\}/);
  });

  it('kontrola ujemna: inne e-maile zachowują notę „masz konto”', async () => {
    const built = buildDeliveryData(
      { template: 'jobPublished', locale: 'pl', payload: { jobTitle: 'Magazynier' } },
      SITE,
    );
    const { html } = await renderEmail('jobPublished', built.locale, built.data as never);
    expect(html).toContain(layoutCopy.pl.footerNote);
  });

  it('niepoprawne dane sprawy w payloadzie → link bez fragmentu (bez wstrzyknięcia)', () => {
    expect(emailTargetPath('reportReceived', { caseNumber: CASE, accessCode: CODE })).toBe(
      `/zglos-tresc/sprawa#nr=${CASE}&kod=${CODE}`,
    );
    expect(emailTargetPath('reportReceived', { caseNumber: 'x"><script>', accessCode: CODE })).toBe(
      '/zglos-tresc/sprawa',
    );
    expect(emailTargetPath('reportReceived', { caseNumber: CASE, accessCode: 'short' })).toBe('/zglos-tresc/sprawa');
  });
});

import { describe, expect, it, vi } from 'vitest';

import type { Locale } from '@/i18n/routing';
import { applicationStatusLabel } from '@/emails/status-labels';
import { renderEmail } from '@/emails/templates';
import { buildDeliveryData, GUEST_TOKEN_TEMPLATES } from '@/lib/email/delivery-data';
import { guestDeliveryToken } from '@/lib/email/guest-delivery';
import { emailPreferenceCategory } from '@/lib/email/categories';

/**
 * #98 (0122) — e-mail do gościa o zmianie statusu aplikacji: w języku z wiersza kolejki
 * (= język formularza gościa), status jako etykieta w tym języku, CTA bez tokenu (linki
 * potwierdzenia/przejęcia bez zmian), z danych firmy tylko nazwa i tytuł oferty.
 */

vi.mock('@/lib/env', () => ({ isProductionMode: vi.fn(() => false), env: { siteUrl: 'https://pracuj.be' } }));

const SITE = 'https://pracuj.be';
const LOCALES: readonly Locale[] = ['pl', 'nl', 'fr', 'en'];
const payload = { recipientName: 'Anna Gość', companyName: 'Acme', jobTitle: 'Magazynier', status: 'shortlisted' };

describe('guestStatusChanged', () => {
  it.each(LOCALES)('%s: status label, job, company, CTA to job list without token', async (locale) => {
    const built = buildDeliveryData({ template: 'guestStatusChanged', locale, payload }, SITE);
    expect(built.locale).toBe(locale);
    expect(built.data['actionUrl']).toBe(`${SITE}/${locale}/oferty-pracy`);

    const { html, subject, text } = await renderEmail('guestStatusChanged', built.locale, built.data as never);
    const label = applicationStatusLabel(locale, 'shortlisted')!;
    expect(label).toBeTruthy();
    expect(html).toContain(label);
    expect(html).toContain('Magazynier');
    expect(html).toContain('Acme');
    expect(html).toContain('Anna Gość');
    expect(html).toContain(`${SITE}/${locale}/oferty-pracy`);
    expect(html).not.toContain('#token=');
    expect(html).not.toContain('shortlisted');
    expect(subject).toContain('Magazynier');
    expect(subject).not.toMatch(/\{\w+\}/);
    expect(html).not.toMatch(/\{\w+\}/);
    expect(text).toContain(label);
  });

  it('is not a token template and has no unsubscribe category (recipient has no account)', () => {
    expect(GUEST_TOKEN_TEMPLATES.has('guestStatusChanged')).toBe(false);
    expect(guestDeliveryToken('guestStatusChanged', { nonce: 'n'.repeat(32) })).toBeUndefined();
    expect(emailPreferenceCategory('guestStatusChanged')).toBeNull();
  });

  it('negative control: unknown status → neutral variant, never the raw code', async () => {
    const built = buildDeliveryData(
      { template: 'guestStatusChanged', locale: 'pl', payload: { ...payload, status: 'weird_code' } },
      SITE,
    );
    const { html } = await renderEmail('guestStatusChanged', built.locale, built.data as never);
    expect(html).not.toContain('weird_code');
    expect(html).toContain('Status Twojej aplikacji został zaktualizowany.');
  });
});

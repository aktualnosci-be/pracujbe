import { describe, expect, it } from 'vitest';

import type { Locale } from '@/i18n/routing';
import { contactTopicLabels, layoutCopy } from '@/emails/copy';
import { renderEmail } from '@/emails/templates';
import { buildDeliveryData } from '@/lib/email/delivery-data';

/**
 * #61 — e-maile formularza kontaktu (worker: wiersz kolejki → dane → render):
 * - `supportContact` do nadawcy w języku z kolumny `locale` (= język formularza), z numerem
 *   i linkiem do Pomocy, bez noty „masz konto” (nadawca zwykle nie ma konta);
 * - `contactMessageAdmin` do admina w JEGO języku (Invariant #1), z etykietą tematu w tym
 *   języku i linkiem do panelu — bez treści wiadomości i adresu nadawcy (nie ma ich w payloadzie).
 */

const SITE = 'https://pracuj.be';
const REF = 'KON-1A2B-3C4D';
const LOCALES: readonly Locale[] = ['pl', 'nl', 'fr', 'en'];

describe('#61: supportContact (potwierdzenie do nadawcy)', () => {
  it.each(LOCALES)('%s: numer, link do Pomocy w języku formularza, bez noty o koncie', async (locale) => {
    const built = buildDeliveryData(
      { template: 'supportContact', locale, payload: { reference: REF, topic: 'technical', recipientName: 'Jan' } },
      SITE,
    );
    const { subject, html } = await renderEmail('supportContact', built.locale, built.data as never);
    expect(subject).toContain(REF);
    expect(html).toContain(REF);
    expect(html).toContain(`${SITE}/${locale}/pomoc`);
    expect(html).toContain(`lang="${locale}"`);
    expect(html).toContain('Jan');
    expect(html).not.toContain(layoutCopy[locale].footerNote);
    expect(`${subject}${html}`).not.toMatch(/\{\w+\}/);
  });
});

describe('#61: contactMessageAdmin (powiadomienie admina)', () => {
  it.each(LOCALES)('%s: temat w języku admina, link do panelu', async (locale) => {
    const built = buildDeliveryData(
      { template: 'contactMessageAdmin', locale, payload: { reference: REF, topic: 'privacy' } },
      SITE,
      'Ada',
    );
    const { subject, html } = await renderEmail('contactMessageAdmin', built.locale, built.data as never);
    expect(subject).toContain(REF);
    expect(html).toContain(contactTopicLabels[locale].privacy);
    expect(html).toContain(`${SITE}/${locale}/admin/kontakt`);
    expect(html).toContain(`lang="${locale}"`);
    expect(`${subject}${html}`).not.toMatch(/\{\w+\}/);
  });

  it('kontrola ujemna: admin z językiem fr nie dostaje etykiety w języku formularza (nl)', async () => {
    const built = buildDeliveryData(
      { template: 'contactMessageAdmin', locale: 'fr', payload: { reference: REF, topic: 'privacy' } },
      SITE,
    );
    const { html } = await renderEmail('contactMessageAdmin', built.locale, built.data as never);
    expect(html).toContain(contactTopicLabels.fr.privacy);
    expect(html).not.toContain(contactTopicLabels.nl.privacy);
  });

  it('nieznany temat → etykieta „inna sprawa”, nie surowy kod', async () => {
    const built = buildDeliveryData(
      { template: 'contactMessageAdmin', locale: 'en', payload: { reference: REF, topic: 'x"><b>' } },
      SITE,
    );
    const { html } = await renderEmail('contactMessageAdmin', built.locale, built.data as never);
    expect(html).toContain(contactTopicLabels.en.other);
    expect(html).not.toContain('x"><b>');
  });
});

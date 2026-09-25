import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { Locale } from '@/i18n/routing';
import { QUEUED_EMAIL_TYPES } from '@/emails/wiring';
import { renderEmail } from '@/emails/templates';
import { buildDeliveryData, deliverySalary } from '@/lib/email/delivery-data';

import { extractEmailPayloads } from '../../scripts/privacy/email-payloads.mjs';
import { loadMigrationFiles } from '../../scripts/privacy/schema.mjs';

/**
 * 0108 (#293, #22, #290): klucze payloadu z AKTUALNYCH definicji `send_offer`/`send_message`
 * w migracjach → worker (`buildDeliveryData`) → render w locale ODBIORCY (Invariant #1).
 * Kontrola ujemna: te same asercje na migracjach bez 0108 (stan sprzed zmiany) padają.
 */

const ROOT = resolve(__dirname, '../..');
const files = loadMigrationFiles(ROOT);
const withoutFollowup = files.filter((f) => !/0108_email_payload_followups\.sql$/.test(f.path));
const SITE = 'https://pracuj.be';
const CONVERSATION = '6f1c2a4e-1b2c-4d5e-8f90-123456789abc';
const OFFER_KEYS = ['expiresAt', 'salaryMin', 'salaryMax', 'salaryPeriod', 'currency'];

function payloadsOf(migrations: typeof files) {
  return extractEmailPayloads(migrations, [...QUEUED_EMAIL_TYPES]);
}

/** Missing keys of the job offer / message payloads (empty = contract met). */
function missingKeys(migrations: typeof files): string[] {
  const payloads = payloadsOf(migrations);
  const offer = payloads.get('jobOffer')?.keys ?? [];
  const message = payloads.get('newMessage')?.keys ?? [];
  return [
    ...OFFER_KEYS.filter((k) => !offer.includes(k)).map((k) => `jobOffer.${k}`),
    ...(message.includes('conversationId') ? [] : ['newMessage.conversationId']),
  ];
}

describe('0108: klucze payloadu z migracji', () => {
  it('send_offer niesie termin i kwoty, send_message identyfikator rozmowy', () => {
    expect(missingKeys(files)).toEqual([]);
    expect(payloadsOf(files).get('jobOffer')?.functions).toEqual(['send_offer']);
    expect(payloadsOf(files).get('newMessage')?.functions).toEqual(['send_message']);
  });

  it('bez treści wiadomości rekrutera ani gotowego tekstu wynagrodzenia (#503, Invariant #1)', () => {
    const offer = payloadsOf(files).get('jobOffer')?.keys ?? [];
    expect(offer).not.toContain('message');
    expect(offer).not.toContain('salary');
    expect(payloadsOf(files).get('newMessage')?.keys).not.toContain('preview');
  });

  it('kontrola ujemna: migracje bez 0108 nie spełniają kontraktu', () => {
    expect(missingKeys(withoutFollowup)).toEqual([...OFFER_KEYS.map((k) => `jobOffer.${k}`), 'newMessage.conversationId']);
  });
});

describe('0108: worker formatuje w locale odbiorcy', () => {
  // Kształt, jaki daje jsonb_build_object: timestamptz jako ISO z przesunięciem, kwoty jako liczby.
  const offerPayload = {
    companyName: 'Acme',
    jobTitle: 'Magazynier',
    expiresAt: '2026-10-31T11:00:00.123456+00:00',
    salaryMin: 2500,
    salaryMax: 3100,
    salaryPeriod: 'month',
    currency: 'EUR',
  };
  const expiry: Record<Locale, string> = {
    pl: '31 października 2026',
    nl: '31 oktober 2026',
    fr: '31 octobre 2026',
    en: '31 October 2026',
  };

  it.each(['pl', 'nl', 'fr', 'en'] as const)('%s: termin i wynagrodzenie w paszporcie', async (locale) => {
    const built = buildDeliveryData({ template: 'jobOffer', locale, payload: offerPayload }, SITE);
    const salary = deliverySalary(offerPayload, locale);
    expect(salary).toBeTruthy();
    expect(built.data['salary']).toBe(salary);
    const { html } = await renderEmail('jobOffer', built.locale, built.data as never);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(doc.querySelector('[data-passport-field="expires-at"]')?.textContent).toContain(expiry[locale]);
    expect(doc.querySelector('[data-passport-field="salary"]')?.textContent).toContain(salary!);
  });

  it('wynagrodzenie zależy od locale odbiorcy, nie od nadawcy', () => {
    expect(deliverySalary(offerPayload, 'pl')).not.toBe(deliverySalary(offerPayload, 'en'));
  });

  it('oferta bez kwot (null z bazy) → bez wiersza wynagrodzenia', async () => {
    const payload = { ...offerPayload, salaryMin: null, salaryMax: null };
    const built = buildDeliveryData({ template: 'jobOffer', locale: 'nl', payload }, SITE);
    expect(built.data['salary']).toBeUndefined();
    const { html } = await renderEmail('jobOffer', built.locale, built.data as never);
    expect(html).not.toContain('data-passport-field="salary"');
  });

  it('newMessage: przycisk prowadzi do wątku w języku odbiorcy', () => {
    const built = buildDeliveryData(
      { template: 'newMessage', locale: 'fr', payload: { senderName: 'Acme', panel: 'candidate', conversationId: CONVERSATION } },
      SITE,
    );
    expect(built.data['messageUrl']).toBe(`${SITE}/fr/candidate/wiadomosci?c=${CONVERSATION}`);
  });
});

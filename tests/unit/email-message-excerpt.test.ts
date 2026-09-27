// @vitest-environment node
import { describe, expect, it } from 'vitest';

import type { Locale } from '@/i18n/routing';
import { jobOfferExcerptLabel } from '@/emails/copy';
import { renderEmail } from '@/emails/templates';
import { buildDeliveryData } from '@/lib/email/delivery-data';
import { EXCERPT_REDACTION, MESSAGE_EXCERPT_MAX, buildMessageExcerpt } from '@/lib/email/message-excerpt';
import { EMAIL_PAYLOAD_FIELDS } from '@/lib/email/payload-fields';

/**
 * #503 — decyzja właściciela 26.09.2026: e-mail `jobOffer` niesie krótki cytat wiadomości
 * rekrutera (`messageExcerpt`, ≤ 200 znaków) bez danych kontaktowych, URL-i i identyfikatorów.
 * Pełny `message` nadal odrzucany. Kontrole ujemne: bez oczyszczenia kanarki trafiają do maila.
 */

const SITE = 'https://pracuj.be';
const LOCALES: readonly Locale[] = ['pl', 'nl', 'fr', 'en'];

/** Kanarki danych, które nie mogą przejść do cytatu (NISS i karta eID z poprawną sumą mod 97). */
const CANARIES = {
  email: 'rekruter.canary@acme-example.be',
  phoneIntl: '+32 470 12 34 56',
  phoneNational: '0470 98 76 54',
  url: 'https://acme-example.be/aplikuj?ref=canary',
  www: 'www.canary-example.com',
  bareUrl: 'canary-example.org/formularz',
  niss: '85.07.30-033.28',
  eid: '592-1234567-32',
  passport: 'paszport nr EH1234567',
} as const;

const RAW_MESSAGE =
  `Dzień dobry, zapraszamy na rozmowę w poniedziałek o 9:00. Proszę pisać na ${CANARIES.email} ` +
  `lub dzwonić ${CANARIES.phoneIntl} / ${CANARIES.phoneNational}. Szczegóły: ${CANARIES.url}, ` +
  `${CANARIES.www}, ${CANARIES.bareUrl}. Numery: ${CANARIES.niss}, ${CANARIES.eid}, ${CANARIES.passport}.`;

function leaked(text: string): string[] {
  return Object.values(CANARIES).filter((c) => text.includes(c));
}

describe('buildMessageExcerpt', () => {
  it('usuwa e-maile, telefony, URL-e, NISS i numery dokumentów', () => {
    const excerpt = buildMessageExcerpt(RAW_MESSAGE);
    expect(excerpt).not.toBeNull();
    for (const canary of Object.values(CANARIES)) expect(excerpt, canary).not.toContain(canary);
    expect(excerpt).not.toContain('@');
    expect(excerpt).toContain('Dzień dobry, zapraszamy na rozmowę');
  });

  it('każdy kanarek osobno: żaden nie przechodzi, także w długiej wiadomości', () => {
    for (const canary of Object.values(CANARIES)) {
      const excerpt = buildMessageExcerpt(`Zapraszamy. Kontakt: ${canary} — do zobaczenia.`) ?? '';
      expect(excerpt, canary).not.toContain(canary);
      expect(excerpt.replace(/\s/g, ''), canary).not.toContain(canary.replace(/\s/g, ''));
      expect(excerpt, canary).toContain(EXCERPT_REDACTION);
    }
  });

  it('obcina do 200 znaków (z wielokropkiem) i nie zostawia połowy numeru', () => {
    const long = `${'Praca na magazynie w Gent, zmiany dzienne. '.repeat(6)}Tel. ${CANARIES.phoneIntl}`;
    const excerpt = buildMessageExcerpt(long)!;
    expect(excerpt.length).toBeLessThanOrEqual(MESSAGE_EXCERPT_MAX);
    expect(excerpt.endsWith('…')).toBe(true);
    expect(excerpt).not.toMatch(/\+32|470/);
    // Ponowne oczyszczenie (delivery-data) nie zmienia gotowego cytatu.
    expect(buildMessageExcerpt(excerpt)).toBe(excerpt);
  });

  it('krótka wiadomość bez danych zostaje bez zmian (poza zwinięciem białych znaków)', () => {
    expect(buildMessageExcerpt('  Zapraszamy\n\nod poniedziałku.  ')).toBe('Zapraszamy od poniedziałku.');
  });

  it('brak treści albo same dane kontaktowe → brak cytatu', () => {
    for (const v of [null, undefined, 42, '', '   ', CANARIES.email, `${CANARIES.phoneIntl}, ${CANARIES.url}`]) {
      expect(buildMessageExcerpt(v), String(v)).toBeNull();
    }
  });
});

describe('jobOffer na ścieżce workera', () => {
  it('lista pól: tylko messageExcerpt, pełny message poza listą', () => {
    const fields: readonly string[] = EMAIL_PAYLOAD_FIELDS.jobOffer;
    expect(fields).toContain('messageExcerpt');
    expect(fields).not.toContain('message');
  });

  it.each(LOCALES)('%s: cytat oczyszczony, podpis w języku odbiorcy, bez kanarków', async (locale) => {
    const built = buildDeliveryData(
      {
        template: 'jobOffer',
        locale,
        // Worker dokłada surowy tekst? delivery-data i tak oczyszcza; pełny `message` odrzucony.
        payload: { companyName: 'Acme', jobTitle: 'Magazynier', message: RAW_MESSAGE, messageExcerpt: RAW_MESSAGE },
      },
      SITE,
    );
    expect(built.data['message']).toBeUndefined();
    const { subject, html, text } = await renderEmail('jobOffer', built.locale, built.data as never);
    const out = `${subject}\n${html}\n${text}`;
    expect(out).toContain('zapraszamy na rozmowę w poniedziałek');
    expect(text).toContain(jobOfferExcerptLabel[locale]);
    for (const other of LOCALES.filter((l) => l !== locale)) expect(text).not.toContain(jobOfferExcerptLabel[other]);
    for (const canary of Object.values(CANARIES)) expect(out, canary).not.toContain(canary);
  });

  it('bez cytatu: brak podpisu', async () => {
    const built = buildDeliveryData({ template: 'jobOffer', locale: 'nl', payload: { companyName: 'Acme', jobTitle: 'X' } }, SITE);
    const { text } = await renderEmail('jobOffer', 'nl', built.data as never);
    expect(text).not.toContain(jobOfferExcerptLabel.nl);
  });

  it('kontrola ujemna: szablon bez oczyszczenia pokazałby dane kontaktowe', async () => {
    const { html } = await renderEmail('jobOffer', 'pl', {
      companyName: 'Acme',
      jobTitle: 'Magazynier',
      messageExcerpt: RAW_MESSAGE,
      offerUrl: `${SITE}/pl/candidate/propozycje`,
    });
    expect(leaked(html).length).toBeGreaterThan(0);
    expect(html).toContain(CANARIES.email);
  });
});

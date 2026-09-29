// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { buildDeliveryData } from '@/lib/email/delivery-data';
import { contactFormSchema } from '@/lib/validation/contact';
import { contentReportFormSchema } from '@/lib/validation/content-report';
import { isSimpleDisplayName, safeDisplayNameForEmail } from '@/lib/validation/display-name';

/**
 * Imię z publicznych formularzy (kontakt, zgłoszenie treści) trafia do powitania w e-mailu
 * z potwierdzeniem: dozwolona tylko prosta postać, egzekwowana w schematach (klient i serwer)
 * oraz ponownie w workerze (zlecenia zapisane przed walidacją).
 */

const OK = ['', 'Anna', 'Anna Nowak', 'Anne-Marie', "O'Brien", 'Zoë Müller', 'Łukasz Żółć', 'Élodie Lefèvre', 'Jan van der Berg'];
const BAD = [
  'evil.com',
  'Zobacz https://przyklad.example',
  'Anna <b>',
  'Anna@firma',
  'Jan 123',
  'Wygrałeś 500 EUR!',
  'Anna\nNowak',
  '-Anna',
  'A'.repeat(81),
  '📞 Anna',
];

describe('isSimpleDisplayName', () => {
  it.each(OK)('przyjmuje %j', (v) => expect(isSimpleDisplayName(v)).toBe(true));
  it.each(BAD)('odrzuca %j', (v) => expect(isSimpleDisplayName(v)).toBe(false));
  it('kontrola ujemna: adres w polu imienia nie jest imieniem', () => {
    expect(isSimpleDisplayName('www.oszust.example')).toBe(false);
  });
});

describe('schematy formularzy', () => {
  const contact = { topic: 'other', message: 'Proszę o kontakt w sprawie konta.', senderEmail: 'a@example.com' };
  const report = {
    category: 'fraud',
    details: 'Ogłoszenie wygląda na próbę wyłudzenia opłaty.',
    contentUrl: '',
    reporterEmail: 'a@example.com',
    goodFaith: true,
  };

  it.each(OK)('kontakt: %j przechodzi', (senderName) => {
    expect(contactFormSchema.safeParse({ ...contact, senderName }).success).toBe(true);
  });
  it.each(BAD)('kontakt: %j → contact.error.nameInvalid albo nameTooLong', (senderName) => {
    const r = contactFormSchema.safeParse({ ...contact, senderName });
    expect(r.success).toBe(false);
    const msgs = r.success ? [] : r.error.issues.map((i) => i.message);
    expect(msgs.some((m) => m === 'contact.error.nameInvalid' || m === 'contact.error.sensitiveId')).toBe(true);
  });
  it.each(OK)('zgłoszenie: %j przechodzi', (reporterName) => {
    expect(contentReportFormSchema.safeParse({ ...report, reporterName }).success).toBe(true);
  });
  it.each(BAD)('zgłoszenie: %j → contentReport.error.nameInvalid', (reporterName) => {
    const r = contentReportFormSchema.safeParse({ ...report, reporterName });
    expect(r.success).toBe(false);
    expect(r.success ? [] : r.error.issues.map((i) => i.message)).toContain('contentReport.error.nameInvalid');
  });
});

describe('worker e-mail: powitanie z formularza', () => {
  const build = (template: string, recipientName: unknown) =>
    buildDeliveryData({ template, locale: 'pl', payload: { recipientName, reference: 'KON-1A2B-3C4D', topic: 'other' } }, 'https://pracuj.be')
      .data;

  it('prosta postać zostaje', () => {
    expect(build('supportContact', 'Anna Nowak')['recipientName']).toBe('Anna Nowak');
    expect(safeDisplayNameForEmail('  Anna ')).toBe('Anna');
  });
  it('adres, cyfry i znaczniki są usuwane (powitanie neutralne)', () => {
    for (const bad of ['evil.com', 'Zobacz https://x.example', '<b>Anna</b>', 'Nagroda 500 EUR', 42, null]) {
      expect(build('supportContact', bad)['recipientName']).toBeUndefined();
      expect(build('reportReceived', bad)['recipientName']).toBeUndefined();
    }
  });
  it('kontrola ujemna: szablon spoza listy formularzowej nie jest filtrowany', () => {
    expect(build('appealReceived', 'Dr. Anna 2')['recipientName']).toBe('Dr. Anna 2');
  });
});

// @vitest-environment node
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { Locale } from '@/i18n/routing';
import type { EmailType } from '@/emails/copy';
import { renderEmail } from '@/emails/templates';
import { GUEST_EMAIL_TYPES, QUEUED_EMAIL_TYPES } from '@/emails/wiring';
import { buildDeliveryData } from '@/lib/email/delivery-data';
import { EMAIL_PAYLOAD_FIELDS, minimizeEmailPayload } from '@/lib/email/payload-fields';

import { extractEmailPayloads } from '../../scripts/privacy/email-payloads.mjs';
import { loadMigrationFiles } from '../../scripts/privacy/schema.mjs';

/**
 * #503 — minimalizacja treści e-maili wysyłanych do dostawcy poczty.
 *
 * 1. Lista pól dozwolonych (`EMAIL_PAYLOAD_FIELDS`) obejmuje każdy wysyłany szablon i nie
 *    zawiera pól z CV, odpowiedziami screeningowymi, treścią korespondencji ani danymi
 *    kontaktowymi.
 * 2. Pola, które funkcje SQL kolejkują, a worker odrzuca, są jawne — nowe pole w payloadzie
 *    wymaga świadomej decyzji (wpis na listę albo do `DROPPED`).
 * 3. Render przez ścieżkę workera (`buildDeliveryData` → `renderEmail`) nie przenosi do
 *    tematu, HTML ani tekstu wartości spoza listy. Kontrola ujemna: bez minimalizacji te same
 *    wartości trafiają do treści.
 */

const ROOT = resolve(__dirname, '../..');
const DELIVERED = [...QUEUED_EMAIL_TYPES, ...GUEST_EMAIL_TYPES] as const;
const LOCALES: readonly Locale[] = ['pl', 'nl', 'fr', 'en'];
const SITE = 'https://pracuj.be';

/** Nazwy pól, które nigdy nie mogą trafić do treści maila bez osobnej oceny. */
const FORBIDDEN = /cv|resume|file|answer|screening|body|preview|^message$|phone|email|address|niss|birth|health/i;

/** Pola kolejkowane przez SQL, których worker świadomie NIE przekazuje do szablonu. */
const DROPPED: Partial<Record<EmailType, readonly string[]>> = {
  appealReceived: ['appealTarget', 'companyName'],
  appealUpheld: ['appealTarget', 'companyName'],
  appealReversed: ['appealTarget', 'companyName'],
  companyVerified: ['reason'],
  guestApplicationConfirm: ['jobSlug', 'nonce'],
  guestApplicationSent: ['nonce'],
  jobMatch: ['query'],
  moderationCompanySuspended: ['jobTitle'],
  teamInvitationSignup: ['nonce'],
};

/**
 * Pola z listy, których SQL dziś nie kolejkuje (dane przyszłych payloadów). Od 0113
 * `jobOffer` (kwoty, `expiresAt`) i `newMessage` (`conversationId`) są już kolejkowane.
 */
const NOT_YET_QUEUED: Partial<Record<EmailType, readonly string[]>> = {};

/** Wartości-kanarki: gdyby którakolwiek trafiła do treści, minimalizacja nie działa. */
const CANARIES = {
  cvFileName: 'CANARY-CV-lebenslauf.pdf',
  screeningAnswers: 'CANARY-ANSWER-diabetes',
  preview: 'CANARY-PREVIEW-rozmowa',
  message: 'CANARY-MESSAGE-oferta',
  body: 'CANARY-BODY-czat',
  phone: '+32 470 12 34 56',
  candidateEmail: 'canary.candidate@example.be',
  query: 'CANARY-QUERY-filtry',
  jobSlug: 'canary-slug-oferty',
} as const;

const files = loadMigrationFiles(ROOT);
const sqlPayloads = extractEmailPayloads(files, [...DELIVERED]);

/** Realistyczne wartości pól dozwolonych — szablon musi się wyrenderować. */
function sampleValue(key: string): unknown {
  switch (key) {
    case 'count':
      return 2;
    case 'jobs':
      return [{ slug: 'magazynier-gent', title: 'Magazynier', companyName: 'Acme', city: 'Gent' }];
    case 'status':
      return 'viewed';
    case 'panel':
      return 'employer';
    case 'appellantRole':
      return 'author';
    case 'groundType':
      return 'terms';
    case 'automatedDetection':
      return false;
    case 'caseNumber':
      return 'DSA-ABCD-EFGH-JKLM-NPQR';
    case 'accessCode':
      return 'ABCD-EFGH-JKLM';
    case 'salaryMin':
      return 2500;
    case 'salaryMax':
      return 3000;
    case 'salaryPeriod':
      return 'month';
    case 'currency':
      return 'EUR';
    case 'expiresAt':
      return '2026-10-31T12:00:00Z';
    case 'conversationId':
      return '6f1c2a4e-1b2c-4d5e-8f90-123456789abc';
    default:
      return `Wartość ${key}`;
  }
}

function payloadWithCanaries(template: EmailType): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...CANARIES, nonce: 'n'.repeat(32) };
  for (const key of EMAIL_PAYLOAD_FIELDS[template as (typeof DELIVERED)[number]]) payload[key] = sampleValue(key);
  return payload;
}

async function renderDelivered(template: EmailType, locale: Locale, payload: Record<string, unknown>) {
  const { data } = buildDeliveryData(
    { template, locale, payload },
    SITE,
    'Odbiorca',
    GUEST_EMAIL_TYPES.includes(template as (typeof GUEST_EMAIL_TYPES)[number]) ? 'guest-token' : undefined,
  );
  const rendered = await renderEmail(template, locale, data as never);
  return `${rendered.subject}\n${rendered.html}\n${rendered.text}`;
}

describe('#503 lista pól e-maili', () => {
  it('obejmuje dokładnie wysyłane szablony (kolejka + gość)', () => {
    expect(Object.keys(EMAIL_PAYLOAD_FIELDS).sort()).toEqual([...DELIVERED].sort());
  });

  it('nie dopuszcza CV, odpowiedzi screeningowych, treści korespondencji ani danych kontaktowych', () => {
    const leaks = Object.entries(EMAIL_PAYLOAD_FIELDS).flatMap(([t, keys]) =>
      keys.filter((k) => FORBIDDEN.test(k)).map((k) => `${t}.${k}`),
    );
    expect(leaks).toEqual([]);
  });

  it('kontrola ujemna: wzorzec łapie pola, których nie wolno wysłać', () => {
    for (const key of ['cvFileId', 'screeningAnswers', 'messageBody', 'preview', 'message', 'phone', 'candidateEmail']) {
      expect(FORBIDDEN.test(key), key).toBe(true);
    }
  });

  it('pola odrzucane przez workera względem SQL są jawne (nowe pole = decyzja)', () => {
    for (const template of DELIVERED) {
      const sqlKeys = sqlPayloads.get(template)?.keys ?? [];
      const allowed: readonly string[] = EMAIL_PAYLOAD_FIELDS[template];
      expect(sqlKeys.filter((k) => !allowed.includes(k)).sort(), `${template}: odrzucane`).toEqual(
        [...(DROPPED[template] ?? [])].sort(),
      );
      expect(allowed.filter((k) => !sqlKeys.includes(k)).sort(), `${template}: spoza SQL`).toEqual(
        [...(NOT_YET_QUEUED[template] ?? [])].sort(),
      );
    }
  });

  it('kontrola ujemna: nowe pole w payloadzie SQL wymaga decyzji', () => {
    const extended = extractEmailPayloads(
      [
        ...files,
        {
          path: 'supabase/migrations/9999_test.sql',
          sql: `create or replace function public.apply_to_job(p uuid) returns uuid language plpgsql as $$
            begin
              perform public.enqueue_email(v_owner, 'newApplication', 'application', v_id, 'k',
                jsonb_build_object('candidateName', v_name, 'jobTitle', v_title, 'candidatePhone', v_phone));
            end $$;`,
        },
      ],
      [...DELIVERED],
    );
    const keys = extended.get('newApplication')?.keys ?? [];
    expect(keys.filter((k) => !(EMAIL_PAYLOAD_FIELDS.newApplication as readonly string[]).includes(k))).toEqual([
      'candidatePhone',
    ]);
  });

  it('minimizeEmailPayload: nieznany szablon i brak payloadu → pusty obiekt', () => {
    expect(minimizeEmailPayload('newsletter', { title: 'x' })).toEqual({});
    expect(minimizeEmailPayload('__proto__', { title: 'x' })).toEqual({});
    expect(minimizeEmailPayload('newApplication', null)).toEqual({});
    expect(minimizeEmailPayload('newApplication', { candidateName: 'A', phone: '1' })).toEqual({ candidateName: 'A' });
  });
});

describe('#503 treść maila na ścieżce workera', () => {
  it.each(LOCALES)('%s: żaden szablon nie przenosi kanarków do tematu, HTML ani tekstu', async (locale) => {
    for (const template of DELIVERED) {
      const out = await renderDelivered(template, locale, payloadWithCanaries(template));
      const found = Object.values(CANARIES).filter((value) => out.includes(value));
      expect(found, template).toEqual([]);
    }
  });

  it('e-mail o aplikacji: imię kandydata i tytuł oferty + link do panelu, bez reszty', async () => {
    const out = await renderDelivered('newApplication', 'nl', {
      candidateName: 'Cleo Candidat',
      jobTitle: 'Magazynier',
      ...CANARIES,
    });
    expect(out).toContain('Cleo Candidat');
    expect(out).toContain(`${SITE}/nl/employer/aplikacje`);
    expect(Object.values(CANARIES).filter((v) => out.includes(v))).toEqual([]);
  });

  it('kontrola ujemna: bez minimalizacji podgląd wiadomości i treść propozycji trafiają do maila', async () => {
    const message = await renderEmail('newMessage', 'pl', {
      senderName: 'Acme',
      preview: CANARIES.preview,
      messageUrl: `${SITE}/pl/candidate/wiadomosci`,
    });
    expect(message.html).toContain(CANARIES.preview);
    const offer = await renderEmail('jobOffer', 'pl', {
      companyName: 'Acme',
      jobTitle: 'Magazynier',
      message: CANARIES.message,
      offerUrl: `${SITE}/pl/candidate/propozycje`,
    });
    expect(offer.html).toContain(CANARIES.message);

    const minimizedMessage = await renderDelivered('newMessage', 'pl', { senderName: 'Acme', preview: CANARIES.preview });
    const minimizedOffer = await renderDelivered('jobOffer', 'pl', {
      companyName: 'Acme',
      jobTitle: 'Magazynier',
      message: CANARIES.message,
    });
    expect(minimizedMessage).not.toContain(CANARIES.preview);
    expect(minimizedOffer).not.toContain(CANARIES.message);
  });
});

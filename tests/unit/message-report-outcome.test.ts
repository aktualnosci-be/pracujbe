import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { Locale } from '@/i18n/routing';
import { emailCopy } from '@/emails/copy';
import { renderEmail } from '@/emails/templates';
import { QUEUED_EMAIL_TYPES } from '@/emails/wiring';
import { titleKeyForType } from '@/lib/data/notifications';
import { buildDeliveryData, emailTargetPath } from '@/lib/email/delivery-data';
import { EMAIL_PAYLOAD_FIELDS } from '@/lib/email/payload-fields';

/**
 * 0208 — wynik zgłoszenia wiadomości/rozmowy dla zgłaszającego: e-mail w języku ODBIORCY
 * (kolumna `locale` wiersza kolejki, Invariant #1), tylko wynik (bez dowodu, opisu i kategorii),
 * CTA do wątku w panelu zgłaszającego; tytuł powiadomienia in-app wg wyniku.
 */

const SITE = 'https://pracuj.be';
const LOCALES: readonly Locale[] = ['pl', 'nl', 'fr', 'en'];
const CONVERSATION = '3f2b8c1e-7d4a-4b5c-9e6f-0a1b2c3d4e5f';
const TEMPLATES = ['messageReportResolved', 'messageReportDismissed'] as const;
/** Kanarki: gdyby payload niósł dowód/opis/kategorię, nie mogą trafić do e-maila. */
const CANARY_BODY = 'Proszę przesłać numer konta i kod PIN 4411';
const CANARY_DETAILS = 'Opis zgłaszającego 7788';

const MIGRATION = readFileSync(
  resolve(__dirname, '../../supabase/migrations/0208_message_report_outcome.sql'),
  'utf8',
);

/** Klucze `jsonb_build_object(...)` przekazane jako payload do `enqueue_email` w SQL. */
function enqueuedPayloadKeys(sql: string): string[] {
  const call = sql.match(/perform public\.enqueue_email\([\s\S]*?\)\);/);
  if (!call) return [];
  const payload = call[0].slice(call[0].indexOf('jsonb_build_object('));
  return [...payload.matchAll(/'([A-Za-z]+)',/g)].map((m) => m[1]!);
}

describe('0208 e-mail z wynikiem zgłoszenia wiadomości', () => {
  it('oba typy są podpięte do kolejki i mają listę pól workera', () => {
    for (const template of TEMPLATES) {
      expect(QUEUED_EMAIL_TYPES).toContain(template);
      expect(EMAIL_PAYLOAD_FIELDS[template]).toEqual(['panel', 'targetType', 'conversationId']);
    }
  });

  it.each(LOCALES)('%s: temat i treść w języku odbiorcy, CTA do wątku, bez dowodu', async (locale) => {
    for (const template of TEMPLATES) {
      for (const panel of ['candidate', 'employer'] as const) {
        const built = buildDeliveryData(
          {
            template,
            locale,
            payload: {
              panel,
              targetType: 'message',
              conversationId: CONVERSATION,
              body: CANARY_BODY,
              details: CANARY_DETAILS,
              category: 'fraud',
              target_snapshot: { message: { body: CANARY_BODY } },
            },
          },
          SITE,
          'Mira',
        );
        const { subject, html, text } = await renderEmail(template, built.locale, built.data as never);
        expect(subject).toBe(emailCopy[template][locale].subject);
        expect(html).toContain(`${SITE}/${locale}/${panel}/wiadomosci?c=${CONVERSATION}`);
        expect(html).toContain('Mira');
        for (const out of [html, text, subject]) {
          expect(out).not.toContain(CANARY_BODY);
          expect(out).not.toContain(CANARY_DETAILS);
          expect(out).not.toMatch(/\{\w+\}/);
        }
      }
    }
  });

  it('treść w każdym języku jest inna (nie kopia jednego języka)', () => {
    for (const template of TEMPLATES) {
      const bodies = new Set(LOCALES.map((l) => emailCopy[template][l].body));
      expect(bodies.size).toBe(LOCALES.length);
    }
    expect(emailCopy.messageReportResolved.pl.body).not.toBe(emailCopy.messageReportDismissed.pl.body);
  });

  it('nieprawidłowy identyfikator rozmowy nie trafia do adresu', () => {
    expect(emailTargetPath('messageReportResolved', { panel: 'employer', conversationId: 'x"><a' })).toBe(
      '/employer/wiadomosci',
    );
    expect(emailTargetPath('messageReportDismissed', null)).toBe('/candidate/wiadomosci');
  });

  it('SQL kolejkuje wyłącznie pola z listy workera (bez dowodu/opisu/kategorii)', () => {
    const keys = enqueuedPayloadKeys(MIGRATION);
    expect(keys.sort()).toEqual(['conversationId', 'panel', 'targetType']);
    for (const template of TEMPLATES) {
      for (const key of keys) expect(EMAIL_PAYLOAD_FIELDS[template]).toContain(key);
    }
    // Idempotencja: klucz = id zgłoszenia + status.
    expect(MIGRATION).toMatch(/'message-report-outcome-' \|\| v_report\.id::text \|\| '-' \|\| v_outcome/);
    // Język z profilu odbiorcy (enqueue_email → resolve_recipient_locale), nie z sesji admina.
    expect(MIGRATION).toMatch(/perform public\.enqueue_email\(v_report\.reporter_id,/);
  });

  it('kontrola ujemna: payload z dowodem zostałby wykryty', () => {
    const mutated = MIGRATION.replace(
      "'conversationId', v_report.conversation_id)",
      "'conversationId', v_report.conversation_id, 'details', v_report.details)",
    );
    expect(mutated).not.toBe(MIGRATION);
    expect(enqueuedPayloadKeys(mutated)).toContain('details');
    expect(EMAIL_PAYLOAD_FIELDS.messageReportResolved).not.toContain('details');
  });
});

describe('0208 powiadomienie in-app', () => {
  it('tytuł wg wyniku; nieznany wynik → ogólny', () => {
    expect(titleKeyForType('system', { kind: 'message_report', outcome: 'resolved' }, 'conversation')).toBe(
      'itemMessageReportResolved',
    );
    expect(titleKeyForType('system', { kind: 'message_report', outcome: 'dismissed' }, 'conversation')).toBe(
      'itemMessageReportDismissed',
    );
    expect(titleKeyForType('system', { kind: 'message_report', outcome: 'open' }, 'conversation')).toBe(
      'itemSystem',
    );
  });
});

// @vitest-environment node
import * as Sentry from '@sentry/nextjs';
import { describe, expect, it } from 'vitest';

import { redactSentryEvent } from '@/lib/sentry-egress';

const PRIVATE = [
  'anna@example.com',
  '+32470123456',
  '85010112345',
  'CV-Anna-Nowak.pdf',
  'Poufna treść wiadomości',
  'https://pracuj.be/pl/aplikacja/potwierdz?token=abc123',
];

describe('Sentry egress', () => {
  it('odrzuca podszyty kod i każdy nieznany atrybut zdarzenia', () => {
    const hint = { attachments: [{ filename: PRIVATE[3]!, data: PRIVATE[4]! }] };
    const event = redactSentryEvent({
      type: undefined,
      message: PRIVATE[4]!,
      request: { url: PRIVATE[5]!, headers: { authorization: PRIVATE[0]! } },
      user: { email: PRIVATE[0]! },
      breadcrumbs: [{ message: PRIVATE[3]! }],
      tags: { errorCode: PRIVATE[2]!, other: PRIVATE[1]! },
    }, hint);
    expect(event.tags).toEqual({ errorCode: 'INTERNAL' });
    expect(hint.attachments).toEqual([]);
    expect(JSON.stringify(event)).not.toMatch(/anna|CV-|token=|85010112345/);
  });

  it('wysyła tylko stabilny kod po przejściu przez rzeczywisty transport SDK', async () => {
    const envelopes: unknown[] = [];
    Sentry.init({
      dsn: 'https://public@example.invalid/1',
      defaultIntegrations: false,
      tracesSampleRate: 0,
      beforeSend: redactSentryEvent,
      transport: () => ({
        send: async (envelope: unknown) => {
          envelopes.push(envelope);
          return { statusCode: 200 };
        },
        flush: async () => true,
      }),
    });

    const error = new Error(PRIVATE.join(' '));
    error.cause = new Error(PRIVATE[4]);
    Sentry.getCurrentScope().addAttachment({ filename: PRIVATE[3]!, data: PRIVATE[4]! });
    Sentry.captureException(error, {
      tags: { errorCode: 'PERMISSION_DENIED', email: PRIVATE[0] },
      extra: { cv: PRIVATE[3], message: PRIVATE[4], tokenUrl: PRIVATE[5] },
      contexts: { person: { phone: PRIVATE[1], niss: PRIVATE[2] } },
    });
    expect(await Sentry.flush(2_000)).toBe(true);

    const payload = JSON.stringify(envelopes);
    expect(envelopes).toHaveLength(1);
    expect(payload).toContain('PERMISSION_DENIED');
    for (const secret of PRIVATE) expect(payload).not.toContain(secret);
    expect(payload).not.toContain('token=');
  });
});

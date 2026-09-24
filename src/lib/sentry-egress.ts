import type * as Sentry from '@sentry/nextjs';

import { ErrorCodes } from '@/lib/errors';

type BeforeSend = NonNullable<Parameters<typeof Sentry.init>[0]['beforeSend']>;
type ErrorEvent = Parameters<BeforeSend>[0];

const ALLOWED_CODES = new Set<string>(Object.values(ErrorCodes));

/** A new event is built from safe fields only; no original URL, exception or extras survive. */
export function redactSentryEvent(event: ErrorEvent, hint?: Parameters<BeforeSend>[1]): ErrorEvent {
  // Attachments are added to the envelope separately from the event payload.
  if (hint) hint.attachments = [];
  const proposed = event.tags?.errorCode;
  const code = typeof proposed === 'string' && ALLOWED_CODES.has(proposed) ? proposed : 'INTERNAL';

  return {
    type: undefined,
    event_id: typeof event.event_id === 'string' && /^[0-9a-f]{32}$/i.test(event.event_id)
      ? event.event_id : undefined,
    timestamp: typeof event.timestamp === 'number' && Number.isFinite(event.timestamp)
      ? event.timestamp : undefined,
    level: 'error',
    platform: 'javascript',
    exception: { values: [{ type: 'ApplicationError', value: code }] },
    tags: { errorCode: code },
    fingerprint: [code],
  };
}

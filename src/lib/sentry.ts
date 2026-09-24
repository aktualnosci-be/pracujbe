import * as Sentry from '@sentry/nextjs';
import { isAppError } from '@/lib/errors';
import { FILTERED, redactValue } from '@/lib/privacy/redact';

/**
 * Klucze kontekstu diagnostycznego, które wolno wysłać do Sentry (typowany allowlist).
 * Wartości i tak przechodzą redakcję (`redactValue`); klucz spoza listy zostaje z wartością
 * `[Filtered]`, więc nowy kontekst z danymi użytkownika nie wyjdzie poza aplikację przez
 * przypadek. Dodając klucz, upewnij się, że niesie wyłącznie kod/obszar/UUID.
 */
export const SAFE_CONTEXT_KEYS = [
  'area', 'digest', 'reason', 'step', 'task', 'rpc', 'action', 'actionType', 'bucket', 'event',
  'client', 'status', 'authCode', 'codes', 'flow', 'failOpen', 'slug', 'deliveryId', 'jobId', 'fileId',
  'providerMessageId',
] as const;

const SAFE_KEYS: ReadonlySet<string> = new Set(SAFE_CONTEXT_KEYS);

export function safeContext(context: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context ?? {})) {
    out[key] = SAFE_KEYS.has(key) ? redactValue(value) : FILTERED;
  }
  return out;
}

/**
 * Zgłasza błąd do Sentry. No-op, gdy brak DSN (np. w trybie demo / lokalnie).
 *
 * Dla `AppError` dodaje kod jako tag i dołącza jego `context` — oba przez allowlist kluczy.
 * Treść wyjątku, `cause`, breadcrumbs i żądanie redaguje dodatkowo `beforeSend`
 * (`src/lib/privacy/sentry-scrub.ts`). Użytkownik widzi tylko komunikat z klucza tłumaczenia.
 */
export function captureError(e: unknown, context?: Record<string, unknown>): void {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) {
    return;
  }

  const extra: Record<string, unknown> = safeContext(context);
  const tags: Record<string, string> = {};

  if (isAppError(e)) {
    tags.errorCode = e.code;
    if (e.context) {
      Object.assign(extra, safeContext(e.context));
    }
  }

  Sentry.captureException(e, { extra, tags });
}

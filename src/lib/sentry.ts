import * as Sentry from '@sentry/nextjs';
import { isAppError } from '@/lib/errors';

/**
 * Zgłasza błąd do Sentry. No-op, gdy brak DSN (np. w trybie demo / lokalnie).
 *
 * Dla `AppError` dodaje kod jako tag i dołącza jego `context`. Kontekst techniczny trafia
 * wyłącznie do monitoringu — użytkownik widzi tylko komunikat z klucza tłumaczenia.
 */
export function captureError(e: unknown, context?: Record<string, unknown>): void {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) {
    return;
  }

  const extra: Record<string, unknown> = { ...context };
  const tags: Record<string, string> = {};

  if (isAppError(e)) {
    tags.errorCode = e.code;
    if (e.context) {
      Object.assign(extra, e.context);
    }
  }

  Sentry.captureException(e, { extra, tags });
}

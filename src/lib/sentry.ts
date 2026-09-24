import * as Sentry from '@sentry/nextjs';
import { isAppError } from '@/lib/errors';

/**
 * Zgłasza błąd do Sentry. No-op, gdy brak DSN (np. w trybie demo / lokalnie).
 *
 * Zachowuje wyłącznie stabilny kod błędu. Surowy wyjątek, `cause` i kontekst wywołania
 * mogą zawierać dane kandydata, więc nie trafiają do SDK (#502).
 */
export function captureError(e: unknown, _context?: Record<string, unknown>): void {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) {
    return;
  }

  const errorCode = isAppError(e) ? e.code : 'INTERNAL';
  // The original exception, cause and caller context can contain candidate data.
  Sentry.captureException(new Error('Application error'), { tags: { errorCode } });
}

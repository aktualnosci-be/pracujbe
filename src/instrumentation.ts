import * as Sentry from '@sentry/nextjs';
import { installConsoleRedaction } from '@/lib/privacy/console';

/**
 * Hook instrumentacji Next.js.
 *
 * Umieszczony w src/ (nie w katalogu głównym), bo projekt trzyma pliki specjalne Next
 * wewnątrz src/ — tak samo jak src/middleware.ts. Dzięki temu Next go wykrywa.
 *
 * Ładuje odpowiednią konfigurację Sentry zależnie od runtime'u. Same konfiguracje są
 * no-op bez NEXT_PUBLIC_SENTRY_DSN, więc bez DSN nic się nie dzieje. Poza trybem
 * deweloperskim logi serwera przechodzą redakcję danych osobowych (`src/lib/privacy`, #502).
 */
export async function register(): Promise<void> {
  if (process.env.NODE_ENV !== 'development') {
    installConsoleRedaction();
  }
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config');
  }
}

/**
 * Przechwytywanie błędów żądań App Routera do Sentry (Next.js onRequestError).
 * No-op, gdy Sentry nie zostało zainicjalizowane (brak DSN).
 */
export const onRequestError = Sentry.captureRequestError;

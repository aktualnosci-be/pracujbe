import * as Sentry from '@sentry/nextjs';

/**
 * Hook instrumentacji Next.js.
 *
 * Umieszczony w src/ (nie w katalogu głównym), bo projekt trzyma pliki specjalne Next
 * wewnątrz src/ — tak samo jak src/middleware.ts. Dzięki temu Next go wykrywa.
 *
 * Ładuje odpowiednią konfigurację Sentry zależnie od runtime'u. Same konfiguracje są
 * no-op bez NEXT_PUBLIC_SENTRY_DSN, więc bez DSN nic się nie dzieje.
 */
export async function register(): Promise<void> {
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

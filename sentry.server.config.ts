import * as Sentry from '@sentry/nextjs';
import { redactSentryEvent } from './src/lib/sentry-egress';

/**
 * Inicjalizacja Sentry po stronie serwera (Node.js runtime).
 *
 * Uruchamia się TYLKO gdy NEXT_PUBLIC_SENTRY_DSN jest ustawione. Bez DSN to no-op —
 * aplikacja buduje się i działa bez konfiguracji Sentry.
 *
 * Prywatność: sendDefaultPii=false — nie dołączamy IP ani danych użytkownika.
 * Ładowany przez src/instrumentation.ts (register) dla runtime 'nodejs'.
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    // Tracing wyłączony, dopóki spany nie mają bramki prywatności przed wysyłką (#502).
    tracesSampleRate: 0,
    beforeSend: redactSentryEvent,
    // Prywatność: nie dołączaj danych osobowych do zdarzeń.
    sendDefaultPii: false,
    // Cichy w konsoli produkcyjnej.
    debug: false,
  });
}

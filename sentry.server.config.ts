import * as Sentry from '@sentry/nextjs';

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
    // Umiarkowane próbkowanie tras (10%) — kontrola kosztów i wpływu na wydajność.
    tracesSampleRate: 0.1,
    // Prywatność: nie dołączaj danych osobowych do zdarzeń.
    sendDefaultPii: false,
    // Cichy w konsoli produkcyjnej.
    debug: false,
  });
}

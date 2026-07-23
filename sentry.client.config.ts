import * as Sentry from '@sentry/nextjs';

/**
 * Inicjalizacja Sentry po stronie przeglądarki.
 *
 * Uruchamia się TYLKO gdy NEXT_PUBLIC_SENTRY_DSN jest ustawione. Bez DSN to no-op —
 * dzięki temu aplikacja buduje się i działa bez konfiguracji Sentry (tryb demo/dev).
 *
 * Prywatność: sendDefaultPii=false (bez IP, cookies i nagłówków użytkownika),
 * Session Replay wyłączony. Nie zbieramy danych osobowych.
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
    // Session Replay wyłączony (prywatność + rozmiar bundle'a klienta).
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    // Cichy w konsoli produkcyjnej.
    debug: false,
  });
}

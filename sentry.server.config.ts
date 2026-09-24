import * as Sentry from '@sentry/nextjs';
import { sentryPrivacyOptions } from '@/lib/privacy/sentry-scrub';

/**
 * Inicjalizacja Sentry po stronie serwera (Node.js runtime).
 *
 * Uruchamia się TYLKO gdy NEXT_PUBLIC_SENTRY_DSN jest ustawione. Bez DSN to no-op —
 * aplikacja buduje się i działa bez konfiguracji Sentry.
 *
 * Prywatność: sendDefaultPii=false + filtr beforeSend/beforeBreadcrumb/beforeSendSpan — nie dołączamy IP ani danych użytkownika.
 * Ładowany przez src/instrumentation.ts (register) dla runtime 'nodejs'.
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    // Umiarkowane próbkowanie tras (10%) — kontrola kosztów i wpływu na wydajność.
    tracesSampleRate: 0.1,
    // Prywatność: bez danych osobowych; redakcja zdarzeń, spanów i breadcrumbów w SDK,
    // PRZED wysłaniem (src/lib/privacy/sentry-scrub.ts). sendDefaultPii=false jest w opcjach.
    ...sentryPrivacyOptions,
    // Cichy w konsoli produkcyjnej.
    debug: false,
  });
}

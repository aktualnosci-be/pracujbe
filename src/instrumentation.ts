import { installErrorWebhook, reportRequestError } from '@/lib/error-webhook';
import { installConsoleRedaction } from '@/lib/privacy/console';

/**
 * Hook instrumentacji Next.js.
 *
 * Umieszczony w src/ (nie w katalogu głównym), bo projekt trzyma pliki specjalne Next
 * wewnątrz src/ — tak samo jak src/middleware.ts. Dzięki temu Next go wykrywa.
 *
 * Rejestruje reporter błędów (#571: webhook Discorda `ERROR_WEBHOOK_URL`, bez Sentry) —
 * pusta zmienna = brak wysyłki. Poza trybem deweloperskim logi serwera przechodzą redakcję
 * danych osobowych (`src/lib/privacy`, #502).
 */
export async function register(): Promise<void> {
  if (process.env.NODE_ENV !== 'development') {
    installConsoleRedaction();
  }
  installErrorWebhook();
}

/**
 * Błędy żądań App Routera (Next.js onRequestError) → webhook: kod błędu i szablon trasy
 * (`/[locale]/oferty-pracy/[slug]`, bez wartości parametrów, query i fragmentu).
 */
export const onRequestError = reportRequestError;

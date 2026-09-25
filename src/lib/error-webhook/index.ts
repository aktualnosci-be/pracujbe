import { errorCodeOf, setErrorReporter } from '@/lib/error-report';

import { createErrorWebhookSender } from './send';

export { parseErrorWebhookUrl, errorWebhookFromEnv } from './url';
export type { ErrorWebhookFormat, ErrorWebhookTarget } from './url';
export { buildErrorWebhookPayload, buildErrorWebhookText, safeRoute, ERROR_WEBHOOK_MAX_CHARS } from './message';
export { createErrorWebhookSender, ERROR_WEBHOOK_DEDUP_MS, ERROR_WEBHOOK_TIMEOUT_MS } from './send';

let installed: ReturnType<typeof createErrorWebhookSender> | null = null;

/**
 * Rejestruje reporter procesu (wołane z `register()` w instrumentation, tylko serwer).
 * Adres czytany przy każdej wysyłce — pusta `ERROR_WEBHOOK_URL` = brak wysyłki.
 */
export function installErrorWebhook(): ReturnType<typeof createErrorWebhookSender> {
  installed ??= createErrorWebhookSender();
  setErrorReporter(installed.reporter);
  return installed;
}

/** Next.js `onRequestError`: kod `INTERNAL`, szablon trasy (bez wartości parametrów). */
export function reportRequestError(
  error: unknown,
  request: { path?: string },
  context: { routePath?: string },
): void {
  const sender = installed ?? installErrorWebhook();
  const route = context?.routePath || request?.path;
  sender.reporter({ code: errorCodeOf(error), route });
}

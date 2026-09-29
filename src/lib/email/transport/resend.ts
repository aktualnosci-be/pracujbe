import { Resend } from 'resend';

import { MailSendError, type MailErrorCode, type MailTransport } from './types';

/**
 * Błędy Resend, po których warto ponowić (limit, awaria dostawcy lub sieci — SDK zgłasza ją jako
 * `application_error`, równoległe żądanie z tym samym kluczem). Reszta = odrzucenie listu.
 */
const RETRYABLE_PROVIDER_ERRORS: ReadonlySet<string> = new Set([
  'rate_limit_exceeded',
  'application_error',
  'internal_server_error',
  'concurrent_idempotent_requests',
  // Limity dnia/miesiąca dotyczą wszystkich listów naraz i mijają same — ponowić.
  'daily_quota_exceeded',
  'monthly_quota_exceeded',
]);

/**
 * #1214: błędy konfiguracji wspólne dla wszystkich listów (klucz, nadawca, domena) — worker
 * odkłada kolejkę bez zużycia próby i podnosi alarm, zamiast kończyć każdy wiersz jako `failed`.
 */
const CONFIGURATION_ERRORS: ReadonlySet<string> = new Set([
  'missing_api_key',
  'invalid_api_key',
  'restricted_api_key',
  'invalid_from_address',
]);

/** `validation_error` o nadawcy/domenie (np. niezweryfikowana domena) = konfiguracja, nie odbiorca. */
const CONFIG_VALIDATION_RE = /domain|`from`|\bfrom\b|sender/i;

export function classifyProviderError(name: string | undefined, message?: string): MailErrorCode {
  if (!name) return 'delivery_failed';
  if (RETRYABLE_PROVIDER_ERRORS.has(name)) return 'provider_unavailable';
  if (CONFIGURATION_ERRORS.has(name)) return 'configuration_error';
  if (name === 'validation_error' && typeof message === 'string' && CONFIG_VALIDATION_RE.test(message)) {
    return 'configuration_error';
  }
  return 'delivery_failed';
}

/**
 * Transport Resend. Idempotencja natywna: nagłówek `Idempotency-Key` = UUID wiersza kolejki,
 * więc ponowienie po utraconej odpowiedzi zwraca identyfikator już przyjętego listu.
 */
export function resendTransport(apiKey: string): MailTransport {
  const resend = new Resend(apiKey);
  return {
    provider: 'resend',
    async send(message, options) {
      // #628: SDK nie przyjmuje sygnału przerwania — po terminie nie zaczynamy żądania, a
      // trwające może się jeszcze zakończyć u dostawcy. Ponowienie z tym samym
      // `Idempotency-Key` nie tworzy wtedy drugiego listu (Resend zwraca pierwszy wynik albo
      // `concurrent_idempotent_requests`, który ponawiamy).
      if (options.signal?.aborted) throw new MailSendError('provider_unavailable');
      const { headers, ...rest } = message;
      const result = await resend.emails.send(
        { ...rest, ...(headers && Object.keys(headers).length > 0 ? { headers } : {}) },
        { idempotencyKey: options.idempotencyKey },
      );
      // Komunikat dostawcy może zawierać adres odbiorcy — nie przenosimy go dalej, tylko kod.
      if (result.error) throw new MailSendError(classifyProviderError(result.error.name, result.error.message));
      // Bez identyfikatora dostawcy nie wolno potwierdzić wysyłki (ACK).
      if (!result.data?.id) throw new MailSendError('provider_unavailable');
      return { id: result.data.id };
    },
  };
}

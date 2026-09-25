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
]);

export function classifyProviderError(name: string | undefined): MailErrorCode {
  return name && RETRYABLE_PROVIDER_ERRORS.has(name) ? 'provider_unavailable' : 'delivery_failed';
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
      const { headers, ...rest } = message;
      const result = await resend.emails.send(
        { ...rest, ...(headers && Object.keys(headers).length > 0 ? { headers } : {}) },
        { idempotencyKey: options.idempotencyKey },
      );
      // Komunikat dostawcy może zawierać adres odbiorcy — nie przenosimy go dalej, tylko kod.
      if (result.error) throw new MailSendError(classifyProviderError(result.error.name));
      // Bez identyfikatora dostawcy nie wolno potwierdzić wysyłki (ACK).
      if (!result.data?.id) throw new MailSendError('provider_unavailable');
      return { id: result.data.id };
    },
  };
}

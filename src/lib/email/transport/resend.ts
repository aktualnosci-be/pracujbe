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
  // Konfiguracja konta/klucza i limity dnia/miesiąca dotyczą wszystkich listów naraz i mijają po
  // poprawce po stronie operatora — nie są odrzuceniem konkretnego listu (nie kończymy wiersza).
  'missing_api_key',
  'invalid_api_key',
  'restricted_api_key',
  'daily_quota_exceeded',
  'monthly_quota_exceeded',
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
      if (result.error) throw new MailSendError(classifyProviderError(result.error.name));
      // Bez identyfikatora dostawcy nie wolno potwierdzić wysyłki (ACK).
      if (!result.data?.id) throw new MailSendError('provider_unavailable');
      return { id: result.data.id };
    },
  };
}

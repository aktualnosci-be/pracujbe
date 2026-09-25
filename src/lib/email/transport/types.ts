/**
 * Wspólny kontrakt transportu poczty (Resend | EmailLabs). Workery kolejki domenowej
 * (`src/lib/email/outbox.ts`) i kolejki kont (`src/lib/auth/email-worker.ts`) znają tylko ten
 * interfejs; wybór dostawcy: `src/lib/email/transport/index.ts` (`EMAIL_PROVIDER`).
 *
 * Gwarancje, które KAŻDY adapter musi zachować:
 * - `send` zwraca identyfikator wiadomości od dostawcy — bez niego wysyłka NIE jest
 *   potwierdzana (ACK), a wiersz wraca do ponowienia;
 * - ponowienie z tym samym `idempotencyKey` (UUID wiersza kolejki) nie tworzy drugiego listu;
 * - błąd = `MailSendError` z ustalonym kodem, bez komunikatu dostawcy (może zawierać adres
 *   odbiorcy albo link z tokenem);
 * - brak śledzenia otwarć/kliknięć po stronie dostawcy, jeśli API na to pozwala.
 */

export const EMAIL_PROVIDERS = ['emaillabs', 'resend'] as const;
export type EmailProvider = (typeof EMAIL_PROVIDERS)[number];

export interface MailMessage {
  /** `EMAIL_FROM`, np. `Pracuj.be <no-reply@pracuj.be>`. */
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Dodatkowe nagłówki (np. `List-Unsubscribe`, `List-Unsubscribe-Post`). */
  headers?: Record<string, string>;
}

export interface MailSendOptions {
  /** UUID wiersza kolejki — klucz idempotencji ponowień. */
  idempotencyKey: string;
}

export type MailErrorCode = 'delivery_failed' | 'provider_unavailable';

/**
 * Błąd wysyłki z ustalonym kodem. `provider_unavailable` = limit, awaria dostawcy lub sieci,
 * brak identyfikatora w odpowiedzi (warto ponowić); `delivery_failed` = odrzucenie listu.
 */
export class MailSendError extends Error {
  constructor(readonly code: MailErrorCode) {
    super(code === 'provider_unavailable' ? 'EMAIL_PROVIDER_UNAVAILABLE' : 'EMAIL_PROVIDER_REJECTED');
    this.name = 'MailSendError';
  }
}

export interface MailTransport {
  readonly provider: EmailProvider;
  send(message: MailMessage, options: MailSendOptions): Promise<{ id: string }>;
}

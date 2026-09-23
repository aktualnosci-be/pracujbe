import { AppError } from '@/lib/errors';

/** Minimalny kształt błędu Supabase Auth, na którym opiera się mapowanie. */
export type SupabaseAuthErrorShape = { code?: string | null; status?: number; message?: string };

/**
 * Mapuje błąd Supabase Auth na `AppError` ze stabilnym kodem (bez wycieku technikaliów).
 *
 * `email_not_confirmed` ma własny kod: Supabase zwraca go dopiero po poprawnym haśle,
 * więc komunikat „potwierdź e-mail” nie ujawnia istnienia konta osobie bez hasła.
 */
export function mapAuthError(error: SupabaseAuthErrorShape): AppError {
  const code = error.code ?? '';
  const status = error.status ?? 0;

  if (status === 429 || code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit') {
    return new AppError('RATE_LIMITED', { cause: error, context: { authCode: code, status } });
  }
  if (code === 'email_not_confirmed') {
    return new AppError('AUTH_EMAIL_NOT_CONFIRMED', { cause: error, context: { authCode: code, status } });
  }
  if (code === 'invalid_credentials' || code === 'invalid_grant' || status === 400) {
    return new AppError('AUTH_INVALID_CREDENTIALS', { cause: error, context: { authCode: code, status } });
  }
  return new AppError('INTERNAL', { cause: error, context: { authCode: code, status } });
}

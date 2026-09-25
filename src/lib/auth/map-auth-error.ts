import { AppError, isAppError } from '@/lib/errors';

/**
 * Minimalny kształt błędu Better Auth (`APIError` z better-call): numeryczny `statusCode`
 * i stabilny `body.code`. Komunikatów SDK (angielskich, czasem z danymi) nie przenosimy do UI.
 */
export type AuthErrorShape = { statusCode?: unknown; body?: { code?: unknown } | null };

const LINK_CODES = new Set(['INVALID_TOKEN', 'TOKEN_EXPIRED', 'USER_NOT_FOUND', 'INVALID_USER']);
const VALIDATION_CODES = new Set([
  'INVALID_EMAIL',
  'INVALID_PASSWORD',
  'PASSWORD_TOO_SHORT',
  'PASSWORD_TOO_LONG',
  'VALIDATED_SIGNUP_REQUIRED',
  'VALIDATION_ERROR',
  'MISSING_FIELD',
]);

/**
 * Mapuje błąd Better Auth na `AppError` ze stabilnym kodem (Invariant #8).
 *
 * `EMAIL_NOT_VERIFIED` ma własny kod: SDK zwraca go dopiero po poprawnym haśle, więc komunikat
 * „potwierdź e-mail” nie ujawnia istnienia konta osobie bez hasła. Nieznany błąd → `INTERNAL`.
 */
export function mapAuthError(error: unknown): AppError {
  if (isAppError(error)) return error;
  const shape = (error ?? {}) as AuthErrorShape;
  const code = typeof shape.body?.code === 'string' ? shape.body.code : '';
  const status = typeof shape.statusCode === 'number' ? shape.statusCode : 0;
  const context = { authCode: code, status };

  if (status === 429) return new AppError('RATE_LIMITED', { cause: error, context });
  if (code === 'EMAIL_NOT_VERIFIED') return new AppError('AUTH_EMAIL_NOT_CONFIRMED', { cause: error, context });
  if (code === 'INVALID_EMAIL_OR_PASSWORD') return new AppError('AUTH_INVALID_CREDENTIALS', { cause: error, context });
  if (LINK_CODES.has(code)) return new AppError('AUTH_LINK_INVALID', { cause: error, context });
  if (VALIDATION_CODES.has(code)) return new AppError('VALIDATION_FAILED', { cause: error, context });
  return new AppError('INTERNAL', { cause: error, context });
}

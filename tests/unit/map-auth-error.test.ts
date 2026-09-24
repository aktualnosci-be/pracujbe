// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { mapAuthError } from '@/lib/auth/map-auth-error';
import { AppError } from '@/lib/errors';

/** Błąd w kształcie `APIError` Better Auth: statusCode + body.code (komunikat SDK pomijamy). */
const apiError = (statusCode: number, code: string) =>
  Object.assign(new Error(`${code}: user@example.com`), { statusCode, body: { code, message: 'x' } });

describe('mapAuthError — kody Better Auth → AppError (#24)', () => {
  it('EMAIL_NOT_VERIFIED → AUTH_EMAIL_NOT_CONFIRMED (nie „nieprawidłowe dane”)', () => {
    const err = mapAuthError(apiError(403, 'EMAIL_NOT_VERIFIED'));
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('AUTH_EMAIL_NOT_CONFIRMED');
    expect(err.userMessageKey).toBe('errors.authEmailNotConfirmed');
  });

  it.each([
    [apiError(401, 'INVALID_EMAIL_OR_PASSWORD'), 'AUTH_INVALID_CREDENTIALS'],
    [apiError(400, 'INVALID_TOKEN'), 'AUTH_LINK_INVALID'],
    [apiError(401, 'TOKEN_EXPIRED'), 'AUTH_LINK_INVALID'],
    [apiError(400, 'PASSWORD_TOO_SHORT'), 'VALIDATION_FAILED'],
    [apiError(400, 'VALIDATED_SIGNUP_REQUIRED'), 'VALIDATION_FAILED'],
    [apiError(429, 'TOO_MANY_REQUESTS'), 'RATE_LIMITED'],
    [apiError(500, 'AUTH_EMAIL_QUEUE_FAILED'), 'INTERNAL'],
    [new Error('connect ECONNREFUSED'), 'INTERNAL'],
    [null, 'INTERNAL'],
  ] as const)('%# → %s', (input, expected) => {
    const err = mapAuthError(input);
    expect(err.code).toBe(expected);
    // Treść komunikatu SDK (tu z adresem e-mail) nie przechodzi do komunikatu błędu aplikacji.
    expect(err.message).not.toContain('@');
  });

  it('AppError przechodzi bez zmian', () => {
    const original = new AppError('RATE_LIMITED');
    expect(mapAuthError(original)).toBe(original);
  });
});

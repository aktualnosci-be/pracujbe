import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

import { mapAuthError } from '@/lib/auth/map-auth-error';
import { toUserMessageKey } from '@/lib/errors';

describe('mapAuthError — kody Supabase Auth → AppError', () => {
  it('email_not_confirmed → AUTH_EMAIL_NOT_CONFIRMED (nie „nieprawidłowe dane”), także przy status 400', () => {
    const err = mapAuthError({ code: 'email_not_confirmed', status: 400, message: 'Email not confirmed' });
    expect(err.code).toBe('AUTH_EMAIL_NOT_CONFIRMED');
    expect(toUserMessageKey(err.code)).toBe('errors.authEmailNotConfirmed');
  });

  it.each([
    [{ code: 'invalid_credentials', status: 400 }, 'AUTH_INVALID_CREDENTIALS'],
    [{ code: 'invalid_grant', status: 400 }, 'AUTH_INVALID_CREDENTIALS'],
    [{ code: null, status: 400 }, 'AUTH_INVALID_CREDENTIALS'],
    [{ code: 'over_request_rate_limit', status: 429 }, 'RATE_LIMITED'],
    [{ code: 'unexpected_failure', status: 500 }, 'INTERNAL'],
  ] as const)('%o → %s', (input, expected) => {
    expect(mapAuthError(input).code).toBe(expected);
  });

  it.each(['pl', 'nl', 'fr', 'en'])('komunikat authEmailNotConfirmed istnieje i różni się od błędnego hasła (%s)', (locale) => {
    const file = resolve(process.cwd(), 'src', 'messages', `${locale}.json`);
    const { errors } = JSON.parse(readFileSync(file, 'utf-8')) as { errors: Record<string, string> };
    expect(errors.authEmailNotConfirmed?.trim()).toBeTruthy();
    expect(errors.authEmailNotConfirmed).not.toBe(errors.authInvalidCredentials);
  });
});

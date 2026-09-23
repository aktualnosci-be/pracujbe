import { describe, expect, it } from 'vitest';
import { zodResolver } from '@hookform/resolvers/zod';

import { registerCandidateSchema, registerEmployerSchema } from '../../src/lib/validation/auth';

/**
 * Komunikaty walidacji rejestracji tak, jak widzi je użytkownik (resolver RHF, pierwszy błąd
 * pola): puste pole = „wymagane”, a niezgodność haseł zgłaszana w tej samej rundzie co inne błędy.
 */

const options = { fields: {}, shouldUseNativeValidation: false, criteriaMode: 'firstError' as const };

async function fieldMessages(
  schema: typeof registerCandidateSchema | typeof registerEmployerSchema,
  values: Record<string, unknown>,
): Promise<Record<string, string | undefined>> {
  const { errors } = await zodResolver(schema)(values, undefined, options);
  return Object.fromEntries(
    Object.entries(errors).map(([name, error]) => [name, (error as { message?: string }).message]),
  );
}

const emptyForm = {
  firstName: '',
  lastName: '',
  email: '',
  password: '',
  passwordConfirm: '',
  agreeTerms: false,
};

describe('pusty formularz rejestracji', () => {
  it('kandydat: każde puste pole ma komunikat „wymagane”', async () => {
    expect(await fieldMessages(registerCandidateSchema, emptyForm)).toEqual({
      firstName: 'auth.error.nameRequired',
      lastName: 'auth.error.nameRequired',
      email: 'auth.error.emailRequired',
      password: 'auth.error.passwordRequired',
      passwordConfirm: 'auth.error.passwordConfirmRequired',
      agreeTerms: 'auth.error.termsRequired',
    });
  });

  it('pracodawca: pusta nazwa firmy ma komunikat „Podaj nazwę firmy”', async () => {
    const messages = await fieldMessages(registerEmployerSchema, { ...emptyForm, companyName: '   ' });
    expect(messages.companyName).toBe('auth.error.companyNameRequired');
    expect(messages.firstName).toBe('auth.error.nameRequired');
  });

  it('zbyt krótkie (niepuste) wartości nadal dają „za krótki”', async () => {
    const messages = await fieldMessages(registerEmployerSchema, {
      ...emptyForm,
      companyName: 'A',
      firstName: 'J',
      password: 'abc1',
    });
    expect(messages.companyName).toBe('auth.error.companyNameTooShort');
    expect(messages.firstName).toBe('auth.error.nameTooShort');
    expect(messages.password).toBe('auth.error.passwordTooShort');
  });
});

describe('niezgodność haseł w tej samej rundzie co inne błędy', () => {
  const mixed = {
    firstName: '',
    lastName: 'Kowalski',
    email: 'jan@',
    password: 'abcdefgh1',
    passwordConfirm: 'x',
    agreeTerms: false,
  };

  it.each([
    ['kandydat', registerCandidateSchema, mixed],
    ['pracodawca', registerEmployerSchema, { ...mixed, companyName: 'A' }],
  ] as const)('%s', async (_label, schema, values) => {
    const messages = await fieldMessages(schema, values);
    expect(messages.email).toBe('auth.error.emailInvalid');
    expect(messages.agreeTerms).toBe('auth.error.termsRequired');
    expect(messages.passwordConfirm).toBe('auth.error.passwordMismatch');
  });

  it('poprawny formularz przechodzi i zachowuje zgodę jako true', async () => {
    const result = registerCandidateSchema.safeParse({
      ...mixed,
      firstName: 'Jan',
      email: 'jan@example.com',
      passwordConfirm: 'abcdefgh1',
      agreeTerms: true,
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.agreeTerms).toBe(true);
  });
});

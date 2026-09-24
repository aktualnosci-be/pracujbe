import { describe, expect, it } from 'vitest';
import { zodResolver } from '@hookform/resolvers/zod';
import { registerCandidateSchema } from '../../src/lib/validation/auth';

const candidate = {
  email: '  candidate@example.com ', password: 'Example123!', passwordConfirm: 'Example123!',
  firstName: ' Jan ', lastName: ' Kowalski ', locale: 'pl' as const, agreeTerms: true as const,
  ageConfirmed: true as const, minAge: 18,
};
const options = { fields: {}, shouldUseNativeValidation: false, criteriaMode: 'all' as const };

describe('Formularz rejestracji po aktualizacji zależności auth', () => {
  it('resolver zachowuje normalizację istniejącego schematu v3', async () => {
    const result = await zodResolver(registerCandidateSchema)(candidate, undefined, options);
    expect(result.errors).toEqual({});
    expect(result.values).toMatchObject({ email: 'candidate@example.com', firstName: 'Jan', lastName: 'Kowalski' });
  });

  it('nie gubi błędów zgody i potwierdzenia hasła ani kluczy tłumaczeń', async () => {
    const result = await zodResolver(registerCandidateSchema)(
      { ...candidate, passwordConfirm: 'Different123!', agreeTerms: false as unknown as true }, undefined, options,
    );
    expect(result.values).toEqual({});
    expect(result.errors.agreeTerms?.message).toBe('auth.error.termsRequired');
    // Niepoprawny literal zatrzymuje refine całego obiektu; sprawdzamy je także osobno.
    const mismatch = await zodResolver(registerCandidateSchema)(
      { ...candidate, passwordConfirm: 'Different123!' }, undefined, options,
    );
    expect(mismatch.errors.passwordConfirm?.message).toBe('auth.error.passwordMismatch');
  });
});

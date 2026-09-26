import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUserById: vi.fn(),
  getAuthRuntime: vi.fn(async () => ({ $context: Promise.resolve({ internalAdapter: { findUserById: mocks.findUserById } }) })),
  captureError: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/runtime', () => ({ getAuthRuntime: mocks.getAuthRuntime }));
vi.mock('@/lib/error-report', () => ({ captureError: mocks.captureError }));

import { companyNameFromMetadata, readSignupCompanyName } from '@/lib/auth/signup-company-name';

afterEach(() => vi.clearAllMocks());

const identity = { id: '11111111-1111-4111-8111-111111111111', role: 'employer' as const };

describe('companyNameFromMetadata', () => {
  it('czyta i przycina nazwę firmy z metadanych rejestracji', () => {
    expect(companyNameFromMetadata({ raw_user_meta_data: { company_name: '  Firma Testowa  ' } })).toBe('Firma Testowa');
  });

  it('brak/puste/nieprawidłowe metadane → null', () => {
    expect(companyNameFromMetadata({})).toBeNull();
    expect(companyNameFromMetadata({ raw_user_meta_data: null })).toBeNull();
    expect(companyNameFromMetadata({ raw_user_meta_data: { company_name: '   ' } })).toBeNull();
    expect(companyNameFromMetadata({ raw_user_meta_data: { company_name: 42 } })).toBeNull();
  });
});

describe('readSignupCompanyName (#365)', () => {
  it('zwraca nazwę firmy z rejestracji WŁASNEGO konta', async () => {
    mocks.findUserById.mockResolvedValue({ id: identity.id, raw_user_meta_data: { company_name: 'ACME sp. z o.o.' } });
    expect(await readSignupCompanyName(identity)).toBe('ACME sp. z o.o.');
    expect(mocks.findUserById).toHaveBeenCalledWith(identity.id);
  });

  it('konto bez metadanych → pusty string (formularz pusty, nie blokuje zakładania firmy)', async () => {
    mocks.findUserById.mockResolvedValue({ id: identity.id });
    expect(await readSignupCompanyName(identity)).toBe('');
  });

  it('konto nieznalezione → pusty string', async () => {
    mocks.findUserById.mockResolvedValue(null);
    expect(await readSignupCompanyName(identity)).toBe('');
  });

  it('awaria odczytu → pusty string + kanał błędów, nigdy wyjątek', async () => {
    const error = new Error('auth db unavailable');
    mocks.findUserById.mockRejectedValue(error);
    expect(await readSignupCompanyName(identity)).toBe('');
    expect(mocks.captureError).toHaveBeenCalledWith(error, { area: 'auth.readSignupCompanyName' });
  });
});

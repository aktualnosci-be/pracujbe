// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Akceptacja regulaminu i potwierdzenie informacji o prywatności (#493: osobne pola) są
 * sprawdzane na SERWERZE: żądanie bez nich nie dociera do SDK. Zgoda na marketing jest
 * opcjonalna i trafia do markera v2 jako osobny wybór. Receipty akceptacji zapisuje trigger 0059 w tej samej transakcji co konto
 * (dowód na PostgreSQL: tests/integration/auth-email-outbox.test.ts) — tutaj sprawdzamy, że
 * akcja wywołuje SDK wyłącznie w walidowanym kontekście z rolą wynikającą z akcji, a błąd
 * zapisu (np. triggera receiptów) kończy rejestrację błędem bez przekierowania.
 */

vi.mock('next-intl/server', () => ({ getLocale: async () => 'pl' }));
vi.mock('next/headers', async () => (await import('../helpers/auth-portal')).headersModule);
vi.mock('next/navigation', async () => (await import('../helpers/auth-portal')).navigationModule);
vi.mock('@/i18n/navigation', async () => (await import('../helpers/auth-portal')).intlNavigationModule);
vi.mock('@/lib/auth/runtime', async () => (await import('../helpers/auth-portal')).runtimeModule);
vi.mock('@/lib/db/runtime', async () => (await import('../helpers/auth-portal')).dbRuntimeModule);
vi.mock('@/lib/db/transaction', async () => (await import('../helpers/auth-portal')).transactionModule);
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: async () => true }));
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));

import { api, authApiError, outcome, resetPortal, stubPortalEnv } from '../helpers/auth-portal';
import { registerCandidate, registerEmployer } from '@/lib/actions/auth';
import { authorizeSignupRequest, signupMetadataForUser } from '@/lib/auth/signup-context';

const candidate = {
  email: 'jan@example.com',
  password: 'Haslo1234',
  passwordConfirm: 'Haslo1234',
  firstName: 'Jan',
  lastName: 'Kowalski',
  locale: 'nl' as const,
  // #492: deklaracja progu wieku kandydata (bez daty urodzenia).
  ageConfirmed: true as const,
  minAge: 18,
};
const { ageConfirmed: _age, minAge: _minAge, ...employerBase } = candidate;
const employer = { ...employerBase, companyName: 'Firma Testowa' };

/** Metadane, które hook SDK zapisałby przy INSERT użytkownika (dokładnie jak w produkcji). */
let captured: ReturnType<typeof signupMetadataForUser> | null = null;

beforeEach(() => {
  resetPortal();
  stubPortalEnv();
  captured = null;
  api.signUpEmail.mockImplementation(async ({ body }: { body: { email: string; password: string; name: string } }) => {
    authorizeSignupRequest(body);
    captured = signupMetadataForUser({ email: body.email, name: body.name });
    return { token: null, user: { id: 'u1' } };
  });
});
afterEach(() => vi.unstubAllEnvs());

describe('rejestracja bez zgody na regulamin', () => {
  const withoutConsent: Array<[string, Record<string, unknown>]> = [
    ['brak pola', {}],
    ['false', { agreeTerms: false }],
    ['napis "true"', { agreeTerms: 'true' }],
    ['1', { agreeTerms: 1 }],
    // #493: informacja o prywatności to osobne, wymagane pole — sam regulamin nie wystarcza.
    ['regulamin bez informacji o prywatności', { agreeTerms: true }],
    ['informacja o prywatności bez regulaminu', { privacyNoticeAck: true }],
    ['informacja o prywatności "true"', { agreeTerms: true, privacyNoticeAck: 'true' }],
  ];

  it.each(withoutConsent)('kandydat (%s) — odrzucone, konto nie powstaje', async (_label, extra) => {
    const result = await outcome(() => registerCandidate({ ...candidate, ...extra } as never));
    expect(result).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(api.signUpEmail).not.toHaveBeenCalled();
  });

  it.each(withoutConsent)('pracodawca (%s) — odrzucone, konto nie powstaje', async (_label, extra) => {
    const result = await outcome(() => registerEmployer({ ...employer, ...extra } as never));
    expect(result).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(api.signUpEmail).not.toHaveBeenCalled();
  });
});

describe('rejestracja ze zgodą', () => {
  it('kandydat: kontekst z rolą candidate, zgodą i językiem formularza → strona potwierdzenia', async () => {
    const result = await outcome(() => registerCandidate({ ...candidate, agreeTerms: true, privacyNoticeAck: true }));
    expect(result).toEqual({ redirect: '/nl/potwierdzenie' });
    expect(captured).toMatchObject({
      role: 'candidate', agree_terms: true, locale: 'nl', signup_receipt_version: 2,
      // #493: osobne elementy; niezaznaczona zgoda opcjonalna = odmowa.
      privacy_notice_ack: true, optional_consents: { email_marketing: false },
    });
    expect(new Set(Object.values(captured?.consent_wording ?? {})).size).toBe(3);
    expect(captured).not.toHaveProperty('company_name');
  });

  it('pracodawca: rola employer i nazwa firmy do bootstrapu po potwierdzeniu', async () => {
    const result = await outcome(() => registerEmployer({ ...employer, agreeTerms: true, privacyNoticeAck: true }));
    expect(result).toEqual({ redirect: '/nl/potwierdzenie' });
    expect(captured).toMatchObject({ role: 'employer', agree_terms: true, company_name: 'Firma Testowa' });
  });

  it('zgoda na marketing zaznaczona — trafia do markera jako osobny wybór (#493)', async () => {
    const result = await outcome(() =>
      registerEmployer({ ...employer, agreeTerms: true, privacyNoticeAck: true, marketingOptIn: true }),
    );
    expect(result).toEqual({ redirect: '/nl/potwierdzenie' });
    expect(captured?.optional_consents).toEqual({ email_marketing: true });
  });

  it('pole role=admin z formularza jest ignorowane (rolę wybiera akcja)', async () => {
    await outcome(() => registerCandidate({ ...candidate, agreeTerms: true, privacyNoticeAck: true, role: 'admin' } as never));
    expect(captured?.role).toBe('candidate');
  });

  it('błąd zapisu konta/receiptu w SDK — rejestracja nieudana, bez przekierowania i technikaliów', async () => {
    api.signUpEmail.mockRejectedValue(new Error('insert or update on table "document_acceptances" violates'));
    const result = await outcome(() => registerEmployer({ ...employer, agreeTerms: true, privacyNoticeAck: true }));
    expect(result).toEqual({ ok: false, error: 'INTERNAL' });
    expect(JSON.stringify(result)).not.toContain('document_acceptances');
  });

  it('istniejący adres (neutralny sukces SDK) — to samo przekierowanie co nowe konto', async () => {
    api.signUpEmail.mockResolvedValue({ token: null, user: { id: 'syntetyczny' } });
    const result = await outcome(() => registerCandidate({ ...candidate, agreeTerms: true, privacyNoticeAck: true }));
    expect(result).toEqual({ redirect: '/nl/potwierdzenie' });
  });

  it('odrzucone przez SDK hasło → VALIDATION_FAILED', async () => {
    api.signUpEmail.mockRejectedValue(authApiError(400, 'PASSWORD_TOO_LONG'));
    expect(await outcome(() => registerCandidate({ ...candidate, agreeTerms: true, privacyNoticeAck: true }))).toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
    });
  });
});

describe('rejestracja kandydata — deklaracja progu wieku (#492)', () => {
  it.each([
    ['brak deklaracji', { ageConfirmed: undefined }],
    ['deklaracja false', { ageConfirmed: false }],
    ['brak progu', { minAge: undefined }],
    ['próg poza zakresem', { minAge: 19 }],
  ])('%s — odrzucone, konto nie powstaje', async (_label, extra) => {
    const input = { ...candidate, agreeTerms: true, privacyNoticeAck: true, ...extra } as unknown as Parameters<typeof registerCandidate>[0];
    const result = await outcome(() => registerCandidate(input));
    expect(result).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(api.signUpEmail).not.toHaveBeenCalled();
  });

  it('metadane dla triggera zawierają sam próg (bez daty urodzenia)', async () => {
    const result = await outcome(() => registerCandidate({ ...candidate, agreeTerms: true, privacyNoticeAck: true }));
    expect(result).toEqual({ redirect: '/nl/potwierdzenie' });
    expect(captured).toMatchObject({ role: 'candidate', age_min_attested: 18 });
    expect(JSON.stringify(captured)).not.toMatch(/birth|urodz/i);
  });

  it('trigger odrzuca próg (zmieniony w bazie) — kod AGE_ATTESTATION_REQUIRED, bez technikaliów', async () => {
    api.signUpEmail.mockRejectedValue(
      new Error('Failed to create user', { cause: new Error('AGE_ATTESTATION_REQUIRED: deklaracja poniżej progu') }),
    );
    const result = await outcome(() => registerCandidate({ ...candidate, agreeTerms: true, privacyNoticeAck: true }));
    expect(result).toEqual({ ok: false, error: 'AGE_ATTESTATION_REQUIRED' });
  });

  it('pracodawca nie składa deklaracji wieku kandydata', async () => {
    const result = await outcome(() => registerEmployer({ ...employer, agreeTerms: true, privacyNoticeAck: true }));
    expect(result).toEqual({ redirect: '/nl/potwierdzenie' });
    expect(captured).not.toHaveProperty('age_min_attested');
  });
});

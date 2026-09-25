// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 0108 — rejestracja pracodawcy z linku zaproszenia do zespołu. Konto powstaje tylko dla
 * ważnego, niezużytego tokenu i adresu zaproszenia, bez nazwy firmy w metadanych (brak
 * bootstrapu firmy — zaproszenie czeka w panelu), a token jest zużywany po rejestracji.
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
vi.mock('@/lib/team/invite-signup', () => ({
  readTeamInvitationSignup: vi.fn(),
  consumeTeamInvitationSignup: vi.fn(),
}));

import { api, outcome, resetPortal, stubPortalEnv } from '../helpers/auth-portal';
import { registerInvitedEmployer } from '@/lib/actions/auth';
import { authorizeSignupRequest, signupMetadataForUser } from '@/lib/auth/signup-context';
import { consumeTeamInvitationSignup, readTeamInvitationSignup } from '@/lib/team/invite-signup';

const TOKEN = 'a'.repeat(43);
const input = {
  email: 'Nowy@Firma.be',
  password: 'Haslo1234',
  passwordConfirm: 'Haslo1234',
  firstName: 'Nina',
  lastName: 'Nowak',
  locale: 'fr' as const,
  agreeTerms: true as const,
};
const valid = {
  status: 'valid' as const,
  companyName: 'Acme',
  role: 'recruiter' as const,
  email: 'nowy@firma.be',
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
};

let captured: ReturnType<typeof signupMetadataForUser> | null = null;

beforeEach(() => {
  resetPortal();
  stubPortalEnv();
  captured = null;
  vi.mocked(readTeamInvitationSignup).mockReset().mockResolvedValue(valid);
  vi.mocked(consumeTeamInvitationSignup).mockReset().mockResolvedValue('consumed');
  api.signUpEmail.mockImplementation(async ({ body }: { body: { email: string; password: string; name: string } }) => {
    authorizeSignupRequest(body);
    captured = signupMetadataForUser({ email: body.email, name: body.name });
    return { token: null, user: { id: 'u1' } };
  });
});
afterEach(() => vi.unstubAllEnvs());

describe('registerInvitedEmployer', () => {
  it('ważny link: konto pracodawcy BEZ nazwy firmy, token zużyty, strona potwierdzenia', async () => {
    const result = await outcome(() => registerInvitedEmployer(input, TOKEN));
    expect(result).toEqual({ redirect: '/fr/potwierdzenie' });
    expect(captured).toMatchObject({ role: 'employer', agree_terms: true, locale: 'fr' });
    expect(captured).not.toHaveProperty('company_name');
    expect(readTeamInvitationSignup).toHaveBeenCalledWith(TOKEN);
    expect(consumeTeamInvitationSignup).toHaveBeenCalledWith(TOKEN, 'nowy@firma.be');
  });

  it.each([
    ['zużyty', { status: 'used' as const }],
    ['nieważny', { status: 'invalid' as const }],
    ['inny adres', { ...valid, email: 'ktos@firma.be' }],
  ])('KONTROLA UJEMNA: link %s → AUTH_LINK_INVALID, konto nie powstaje', async (_label, preview) => {
    vi.mocked(readTeamInvitationSignup).mockResolvedValue(preview);
    expect(await outcome(() => registerInvitedEmployer(input, TOKEN))).toEqual({ ok: false, error: 'AUTH_LINK_INVALID' });
    expect(api.signUpEmail).not.toHaveBeenCalled();
    expect(consumeTeamInvitationSignup).not.toHaveBeenCalled();
  });

  it('bez zgody na regulamin → VALIDATION_FAILED przed odczytem tokenu', async () => {
    const result = await outcome(() => registerInvitedEmployer({ ...input, agreeTerms: false } as never, TOKEN));
    expect(result).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(readTeamInvitationSignup).not.toHaveBeenCalled();
  });

  it('nazwa firmy z formularza nie trafia do metadanych (brak bootstrapu firmy)', async () => {
    await outcome(() => registerInvitedEmployer({ ...input, companyName: 'Obca' } as never, TOKEN));
    expect(captured).not.toHaveProperty('company_name');
  });

  it('awaria zużycia tokenu nie cofa utworzonego konta', async () => {
    vi.mocked(consumeTeamInvitationSignup).mockRejectedValue(new Error('db down'));
    expect(await outcome(() => registerInvitedEmployer(input, TOKEN))).toEqual({ redirect: '/fr/potwierdzenie' });
  });
});

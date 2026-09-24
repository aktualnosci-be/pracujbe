import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  claimGuestApplication,
  confirmGuestApplication,
  submitGuestApplication,
} from '@/lib/actions/guest-applications';
import { hasServiceRoleKey, isProductionMode, isSupabaseConfigured } from '@/lib/env';
import { guestTokenFromNonce, hashGuestToken } from '@/lib/guest-apply/token';
import { clearGuestLinkToken, readGuestLinkToken } from '@/lib/guest-apply/link-cookie';
import { checkRateLimit } from '@/lib/rate-limit';
import { enforceTurnstile } from '@/lib/turnstile/verify';

/**
 * #98 — Server Actions aplikacji bez konta: kolejność ochron (limit, Turnstile, walidacja),
 * do bazy trafia hash tokenu (nigdy token), neutralny sukces, mapowanie wyników RPC na kody
 * bez technikaliów (Invariant #8).
 */

const adminRpc = vi.fn();
const userRpc = vi.fn();

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers({ 'x-real-ip': '203.0.113.9', 'user-agent': 'UA' })),
}));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(async () => true) }));
vi.mock('@/lib/guest-apply/link-cookie', () => ({
  readGuestLinkToken: vi.fn(async () => null),
  clearGuestLinkToken: vi.fn(async () => undefined),
}));
vi.mock('@/lib/turnstile/verify', () => ({ enforceTurnstile: vi.fn(async () => null) }));
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));
vi.mock('@/lib/env', () => ({
  isSupabaseConfigured: vi.fn(() => true),
  hasServiceRoleKey: vi.fn(() => true),
  isProductionMode: vi.fn(() => false),
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => ({ rpc: adminRpc })) }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn(async () => ({ rpc: userRpc })) }));

const input = {
  jobId: '11111111-1111-4111-8111-111111111111',
  fullName: '  Anna Nowak ',
  email: ' Anna@Example.COM ',
  locale: 'nl' as const,
  agreeTerms: true as const,
  ageConfirmed: true as const,
  minAge: 18,
  idempotencyKey: '22222222-2222-4222-8222-222222222222',
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GUEST_APPLY_SECRET = 's'.repeat(40);
  vi.mocked(isSupabaseConfigured).mockReturnValue(true);
  vi.mocked(hasServiceRoleKey).mockReturnValue(true);
  vi.mocked(isProductionMode).mockReturnValue(false);
  vi.mocked(checkRateLimit).mockResolvedValue(true);
  vi.mocked(readGuestLinkToken).mockResolvedValue(null);
  vi.mocked(enforceTurnstile).mockResolvedValue(null);
  adminRpc.mockResolvedValue({ data: 'request-1', error: null });
});

describe('submitGuestApplication', () => {
  it('stores only the token hash with normalized data, in the form language, and answers neutrally', async () => {
    expect(await submitGuestApplication({ ...input, phone: '470 12 34 56', phoneCountry: 'BE' }, 'bot-token')).toEqual({ ok: true });
    expect(enforceTurnstile).toHaveBeenCalledWith('guestApply', 'bot-token');
    expect(adminRpc).toHaveBeenCalledTimes(1);
    const [name, args] = adminRpc.mock.calls[0]!;
    expect(name).toBe('submit_guest_application');
    expect(args).toMatchObject({
      p_job_id: input.jobId,
      p_email: 'anna@example.com',
      p_full_name: 'Anna Nowak',
      p_phone: '+32470123456',
      p_locale: 'nl',
      p_idempotency_key: input.idempotencyKey,
      p_ip: '203.0.113.9',
      p_user_agent: 'UA',
      // #492: tylko zadeklarowany próg wieku — bez daty urodzenia.
      p_age_attested_min: 18,
    });
    expect(JSON.stringify(args)).not.toMatch(/birth|urodz/i);
    // Hash odpowiada tokenowi z nonce (worker odtworzy link), a sam token nie trafia do RPC.
    const token = guestTokenFromNonce('confirm', args.p_confirm_nonce)!;
    expect(args.p_confirm_token_hash).toBe(hashGuestToken(token));
    expect(JSON.stringify(args)).not.toContain(token);
  });

  it('per-address limit uses a hash, never the address itself', async () => {
    await submitGuestApplication(input);
    const emailCall = vi.mocked(checkRateLimit).mock.calls.find(([action]) => action === 'guest-apply-email');
    expect(emailCall?.[1]?.identifier).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(emailCall)).not.toContain('example.com');
  });

  it.each([
    [{ fullName: '   ' }, 'fullName'],
    [{ email: 'nie-adres' }, 'email'],
    [{ agreeTerms: false as unknown as true }, 'consent'],
    [{ ageConfirmed: false as unknown as true }, 'age'],
    [{ minAge: 12 }, 'age'],
    [{ phone: 'abc', phoneCountry: 'PL' }, 'phone'],
  ])('field error %o → %s, no database write', async (patch, field) => {
    expect(await submitGuestApplication({ ...input, ...patch })).toEqual({ ok: false, error: 'VALIDATION_FAILED', field });
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it('rate limit and bot check stop the request before validation and the database', async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce(false);
    expect(await submitGuestApplication(input)).toEqual({ ok: false, error: 'RATE_LIMITED' });
    vi.mocked(enforceTurnstile).mockResolvedValueOnce('BOT_CHECK_FAILED');
    expect(await submitGuestApplication(input)).toEqual({ ok: false, error: 'BOT_CHECK_FAILED' });
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it('demo mode and missing production secret do not pretend success', async () => {
    vi.mocked(isSupabaseConfigured).mockReturnValueOnce(false);
    expect(await submitGuestApplication(input)).toEqual({ ok: false, error: 'DEMO_UNAVAILABLE' });
    vi.mocked(isProductionMode).mockReturnValue(true);
    delete process.env.GUEST_APPLY_SECRET;
    expect(await submitGuestApplication(input)).toEqual({ ok: false, error: 'GUEST_APPLY_UNAVAILABLE' });
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it('#101: passes screening answers and maps a missing required answer to its question', async () => {
    const q = '33333333-3333-4333-8333-333333333333';
    adminRpc.mockResolvedValueOnce({ data: null, error: { message: `SCREENING_ANSWER_REQUIRED: ${q}` } });
    expect(await submitGuestApplication({ ...input, answers: { [q]: true } })).toEqual({
      ok: false,
      error: 'SCREENING_ANSWER_REQUIRED',
      questionId: q,
    });
    expect(adminRpc.mock.calls[0]![1]).toMatchObject({ p_answers: { [q]: true } });
    await submitGuestApplication(input);
    expect(adminRpc.mock.calls[1]![1]).toMatchObject({ p_answers: null });
  });

  it('#492: próg w bazie wyższy niż zadeklarowany → błąd przy polu wieku', async () => {
    adminRpc.mockResolvedValueOnce({ data: null, error: { message: 'AGE_ATTESTATION_REQUIRED' } });
    expect(await submitGuestApplication(input)).toEqual({ ok: false, error: 'AGE_ATTESTATION_REQUIRED', field: 'age' });
  });

  it('maps RPC errors without leaking technical details', async () => {
    adminRpc.mockResolvedValueOnce({ data: null, error: { message: 'JOB_NOT_ACTIVE' } });
    expect(await submitGuestApplication(input)).toEqual({ ok: false, error: 'JOB_NOT_ACTIVE' });
    adminRpc.mockResolvedValueOnce({ data: null, error: { message: 'relation "x" does not exist' } });
    expect(await submitGuestApplication(input)).toEqual({ ok: false, error: 'INTERNAL' });
  });
});

describe('confirmGuestApplication', () => {
  const token = guestTokenFromNonce('confirm', 'n'.repeat(32))!;

  it('sends the token hash and a fresh claim hash; returns the outcome and a safe slug', async () => {
    vi.mocked(readGuestLinkToken).mockResolvedValue(token);
    adminRpc.mockResolvedValueOnce({ data: [{ outcome: 'confirmed', locale: 'nl', job_slug: 'magazynier-1' }], error: null });
    expect(await confirmGuestApplication('pl')).toEqual({ ok: true, outcome: 'confirmed', jobSlug: 'magazynier-1' });
    const [name, args] = adminRpc.mock.calls[0]!;
    expect(name).toBe('confirm_guest_application');
    expect(args.p_token_hash).toBe(hashGuestToken(token));
    expect(args.p_claim_token_hash).toBe(hashGuestToken(guestTokenFromNonce('claim', args.p_claim_nonce)!));
    expect(clearGuestLinkToken).toHaveBeenCalledWith('pl', 'confirm');
  });

  it('malformed token → invalid without touching the database', async () => {
    expect(await confirmGuestApplication('pl')).toEqual({ ok: true, outcome: 'invalid' });
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it('unknown outcome or unsafe slug is not passed through', async () => {
    vi.mocked(readGuestLinkToken).mockResolvedValue(token);
    adminRpc.mockResolvedValueOnce({ data: [{ outcome: 'hacked' }], error: null });
    expect(await confirmGuestApplication('pl')).toEqual({ ok: false, error: 'INTERNAL' });
    adminRpc.mockResolvedValueOnce({ data: [{ outcome: 'expired', job_slug: 'javascript:alert(1)' }], error: null });
    expect(await confirmGuestApplication('pl')).toEqual({ ok: true, outcome: 'expired' });
  });
});

describe('claimGuestApplication', () => {
  const token = guestTokenFromNonce('claim', 'c'.repeat(32))!;

  it('runs under the user session with the token hash', async () => {
    vi.mocked(readGuestLinkToken).mockResolvedValue(token);
    userRpc.mockResolvedValueOnce({ data: 'app-1', error: null });
    expect(await claimGuestApplication('pl')).toEqual({ ok: true, applicationId: 'app-1' });
    expect(userRpc).toHaveBeenCalledWith('claim_guest_application', { p_claim_token_hash: hashGuestToken(token) });
    expect(adminRpc).not.toHaveBeenCalled();
    expect(clearGuestLinkToken).toHaveBeenCalledWith('pl', 'claim');
  });

  it.each([
    ['UNAUTHENTICATED', 'UNAUTHENTICATED'],
    ['EMAIL_NOT_VERIFIED', 'EMAIL_NOT_VERIFIED'],
    ['CLAIM_EXPIRED', 'CLAIM_EXPIRED'],
    ['APPLICATION_ALREADY_EXISTS', 'APPLICATION_ALREADY_EXISTS'],
    ['PERMISSION_DENIED: przejąć aplikację może tylko konto kandydata', 'PERMISSION_DENIED'],
    ['NOT_FOUND', 'NOT_FOUND'],
    ['connection reset', 'INTERNAL'],
  ])('%s → %s', async (message, code) => {
    vi.mocked(readGuestLinkToken).mockResolvedValue(token);
    userRpc.mockResolvedValueOnce({ data: null, error: { message } });
    expect(await claimGuestApplication('pl')).toEqual({ ok: false, error: code });
  });

  it('malformed token → NOT_FOUND without a database call', async () => {
    expect(await claimGuestApplication('pl')).toEqual({ ok: false, error: 'NOT_FOUND' });
    expect(userRpc).not.toHaveBeenCalled();
  });
});

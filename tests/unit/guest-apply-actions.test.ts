import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  claimGuestApplication,
  confirmGuestApplication,
  submitGuestApplication,
} from '@/lib/actions/guest-applications';
import { isProductionMode } from '@/lib/env';
import { guestTokenFromNonce, hashGuestToken } from '@/lib/guest-apply/token';
import { clearGuestLinkToken, readGuestLinkToken } from '@/lib/guest-apply/link-cookie';
import { checkRateLimit } from '@/lib/rate-limit';
import { enforceTurnstile } from '@/lib/turnstile/verify';
import { fakeDb, fakeSession, pgError, resetFakeDb } from '../helpers/fake-db';

/**
 * #98 — Server Actions aplikacji bez konta: kolejność ochron (limit, Turnstile, walidacja),
 * do bazy trafia hash tokenu (nigdy token), neutralny sukces, mapowanie wyników RPC na kody
 * bez technikaliów (Invariant #8). RPC 1–2 w transakcji service_role, przejęcie pod sesją.
 */

const CANDIDATE = '44444444-4444-4444-8444-444444444444';
const failRpc = (name: string, message: string) => fakeDb.rpc(name, () => { throw pgError('P0001', message); });

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
vi.mock('@/lib/env', () => ({ isProductionMode: vi.fn(() => false) }));
vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());

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
  resetFakeDb({ id: CANDIDATE, role: 'candidate' });
  vi.mocked(isProductionMode).mockReturnValue(false);
  vi.mocked(checkRateLimit).mockResolvedValue(true);
  vi.mocked(readGuestLinkToken).mockResolvedValue(null);
  vi.mocked(enforceTurnstile).mockResolvedValue(null);
  fakeDb.rpc('submit_guest_application', 'request-1');
});

describe('submitGuestApplication', () => {
  it('stores only the token hash with normalized data, in the form language, and answers neutrally', async () => {
    expect(await submitGuestApplication({ ...input, phone: '470 12 34 56', phoneCountry: 'BE' }, 'bot-token')).toEqual({ ok: true });
    expect(enforceTurnstile).toHaveBeenCalledWith('guestApply', 'bot-token');
    expect(fakeDb.calls).toHaveLength(1);
    const [call] = fakeDb.callsTo('submit_guest_application');
    expect(call!.as).toBe('service');
    const args = call!.args as Record<string, string>;
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
    const token = guestTokenFromNonce('confirm', args.p_confirm_nonce!)!;
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
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('rate limit and bot check stop the request before validation and the database', async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce(false);
    expect(await submitGuestApplication(input)).toEqual({ ok: false, error: 'RATE_LIMITED' });
    vi.mocked(enforceTurnstile).mockResolvedValueOnce('BOT_CHECK_FAILED');
    expect(await submitGuestApplication(input)).toEqual({ ok: false, error: 'BOT_CHECK_FAILED' });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('demo mode and missing production secret do not pretend success', async () => {
    fakeSession.configured = false;
    expect(await submitGuestApplication(input)).toEqual({ ok: false, error: 'DEMO_UNAVAILABLE' });
    fakeSession.configured = true;
    fakeSession.serviceConfigured = false;
    expect(await submitGuestApplication(input)).toEqual({ ok: false, error: 'GUEST_APPLY_UNAVAILABLE' });
    fakeSession.serviceConfigured = true;
    vi.mocked(isProductionMode).mockReturnValue(true);
    delete process.env.GUEST_APPLY_SECRET;
    expect(await submitGuestApplication(input)).toEqual({ ok: false, error: 'GUEST_APPLY_UNAVAILABLE' });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('#101: passes screening answers and maps a missing required answer to its question', async () => {
    const q = '33333333-3333-4333-8333-333333333333';
    failRpc('submit_guest_application', `SCREENING_ANSWER_REQUIRED: ${q}`);
    expect(await submitGuestApplication({ ...input, answers: { [q]: true } })).toEqual({
      ok: false,
      error: 'SCREENING_ANSWER_REQUIRED',
      questionId: q,
    });
    // jsonb: odpowiedzi jako JSON.
    expect(JSON.parse(fakeDb.callsTo('submit_guest_application')[0]!.args['p_answers'] as string)).toEqual({ [q]: true });
    fakeDb.rpc('submit_guest_application', 'request-1');
    await submitGuestApplication(input);
    expect(fakeDb.callsTo('submit_guest_application')[1]!.args).toMatchObject({ p_answers: null });
  });

  it('#492: próg w bazie wyższy niż zadeklarowany → błąd przy polu wieku', async () => {
    failRpc('submit_guest_application', 'AGE_ATTESTATION_REQUIRED');
    expect(await submitGuestApplication(input)).toEqual({ ok: false, error: 'AGE_ATTESTATION_REQUIRED', field: 'age' });
  });

  it('maps RPC errors without leaking technical details', async () => {
    failRpc('submit_guest_application', 'JOB_NOT_ACTIVE');
    expect(await submitGuestApplication(input)).toEqual({ ok: false, error: 'JOB_NOT_ACTIVE' });
    fakeDb.rpc('submit_guest_application', () => { throw pgError('42P01', 'relation "x" does not exist'); });
    expect(await submitGuestApplication(input)).toEqual({ ok: false, error: 'INTERNAL' });
    fakeDb.rpc('submit_guest_application', () => { throw new Error('connect ECONNREFUSED 10.0.0.1:5432'); });
    const result = await submitGuestApplication(input);
    expect(result).toEqual({ ok: false, error: 'INTERNAL' });
    expect(JSON.stringify(result)).not.toContain('ECONNREFUSED');
  });
});

describe('confirmGuestApplication', () => {
  const token = guestTokenFromNonce('confirm', 'n'.repeat(32))!;

  it('sends the token hash and a fresh claim hash; returns the outcome and a safe slug', async () => {
    vi.mocked(readGuestLinkToken).mockResolvedValue(token);
    fakeDb.rpc('confirm_guest_application', [{ outcome: 'confirmed', locale: 'nl', job_slug: 'magazynier-1' }]);
    expect(await confirmGuestApplication('pl')).toEqual({ ok: true, outcome: 'confirmed', jobSlug: 'magazynier-1' });
    const [call] = fakeDb.callsTo('confirm_guest_application');
    expect(call!.kind).toBe('rpcrows');
    expect(call!.as).toBe('service');
    const args = call!.args as Record<string, string>;
    expect(args.p_token_hash).toBe(hashGuestToken(token));
    expect(args.p_claim_token_hash).toBe(hashGuestToken(guestTokenFromNonce('claim', args.p_claim_nonce!)!));
    expect(clearGuestLinkToken).toHaveBeenCalledWith('pl', 'confirm');
  });

  it('malformed token → invalid without touching the database', async () => {
    expect(await confirmGuestApplication('pl')).toEqual({ ok: true, outcome: 'invalid' });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('unknown outcome or unsafe slug is not passed through', async () => {
    vi.mocked(readGuestLinkToken).mockResolvedValue(token);
    fakeDb.rpc('confirm_guest_application', [{ outcome: 'hacked' }]);
    expect(await confirmGuestApplication('pl')).toEqual({ ok: false, error: 'INTERNAL' });
    fakeDb.rpc('confirm_guest_application', [{ outcome: 'expired', job_slug: 'javascript:alert(1)' }]);
    expect(await confirmGuestApplication('pl')).toEqual({ ok: true, outcome: 'expired' });
  });
});

describe('claimGuestApplication', () => {
  const token = guestTokenFromNonce('claim', 'c'.repeat(32))!;

  it('runs under the user session with the token hash', async () => {
    vi.mocked(readGuestLinkToken).mockResolvedValue(token);
    fakeDb.rpc('claim_guest_application', 'app-1');
    expect(await claimGuestApplication('pl')).toEqual({ ok: true, applicationId: 'app-1' });
    expect(fakeDb.calls).toHaveLength(1);
    expect(fakeDb.callsTo('claim_guest_application')[0]).toMatchObject({
      as: CANDIDATE, args: { p_claim_token_hash: hashGuestToken(token) },
    });
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
    failRpc('claim_guest_application', message);
    expect(await claimGuestApplication('pl')).toEqual({ ok: false, error: code });
  });

  it('bez sesji → UNAUTHENTICATED bez wywołania bazy', async () => {
    vi.mocked(readGuestLinkToken).mockResolvedValue(token);
    fakeSession.identity = null;
    expect(await claimGuestApplication('pl')).toEqual({ ok: false, error: 'UNAUTHENTICATED' });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('malformed token → NOT_FOUND without a database call', async () => {
    expect(await claimGuestApplication('pl')).toEqual({ ok: false, error: 'NOT_FOUND' });
    expect(fakeDb.calls).toHaveLength(0);
  });
});

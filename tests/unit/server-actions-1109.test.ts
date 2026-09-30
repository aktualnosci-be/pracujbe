import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveReport, setCompanyStatus } from '@/lib/actions/admin';
import { submitModerationAppeal } from '@/lib/actions/appeals';
import { updateCompany } from '@/lib/actions/company';
import { markNotificationsRead } from '@/lib/actions/notifications';
import { setTeamMemberRole } from '@/lib/actions/team';
import { checkRateLimit } from '@/lib/rate-limit';
import { checkAccountRateLimit } from '@/lib/rate-limit-account';
import { fakeDb, fakeSession, resetFakeDb } from '../helpers/fake-db';

/**
 * #1109 (SA-03, SA-04): limit akcji firmy, zespołu i odwołań liczony na KONTO po odczycie sesji
 * (+ szeroki próg na adres IP) oraz identyfikatory w złym formacie = błąd walidacji zamiast
 * INTERNAL z bazy (22P02).
 */

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ set: vi.fn() })) }));
vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(async () => true) }));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));
vi.mock('@/lib/jobs/public-cache', () => ({ revalidatePublicJobPaths: vi.fn() }));

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const MEMBER = '33333333-3333-4333-8333-333333333333';
const DECISION = '44444444-4444-4444-8444-444444444444';
const KEY = '55555555-5555-4555-8555-555555555555';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkRateLimit).mockResolvedValue(true);
  resetFakeDb({ id: USER, role: 'employer' });
});

describe('checkAccountRateLimit', () => {
  it('budżet na konto (bez IP), potem szeroki próg sieciowy 10× — osobne wiadra', async () => {
    expect(await checkAccountRateLimit('team-manage', USER, { max: 60, windowSeconds: 3600 })).toBe(true);
    expect(vi.mocked(checkRateLimit).mock.calls).toEqual([
      ['team-manage', { identifier: USER, perIp: false, max: 60, windowSeconds: 3600 }],
      ['team-manage-ip', { max: 600, windowSeconds: 3600 }],
    ]);
  });

  it('dwa konta za tym samym adresem mają różne klucze budżetu', async () => {
    await checkAccountRateLimit('company-update', USER, { max: 60, windowSeconds: 3600 });
    await checkAccountRateLimit('company-update', OTHER, { max: 60, windowSeconds: 3600 });
    const ids = vi.mocked(checkRateLimit).mock.calls
      .filter(([a]) => a === 'company-update')
      .map(([, o]) => o?.identifier);
    expect(ids).toEqual([USER, OTHER]);
  });

  it('kontrola ujemna: konto ponad limitem = odmowa bez zużycia progu sieciowego', async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce(false);
    expect(await checkAccountRateLimit('team-manage', USER, { max: 60, windowSeconds: 3600 })).toBe(false);
    expect(checkRateLimit).toHaveBeenCalledTimes(1);
  });
});

describe('akcje: limit po sesji, na konto', () => {
  it('zespół: anonimowe wywołanie nie zużywa żadnego licznika', async () => {
    fakeSession.identity = null;
    expect(await setTeamMemberRole(MEMBER, 'member')).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  it('zespół: zalogowane konto — limit z identyfikatorem konta; przekroczenie = RATE_LIMITED bez RPC', async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce(false);
    expect(await setTeamMemberRole(MEMBER, 'member')).toEqual({ ok: false, error: 'RATE_LIMITED' });
    expect(vi.mocked(checkRateLimit).mock.calls[0]).toEqual([
      'team-manage',
      expect.objectContaining({ identifier: USER, perIp: false }),
    ]);
    expect(fakeDb.callsTo('set_company_member_role')).toHaveLength(0);
  });

  it('firma: anonimowa edycja nie zużywa licznika; zalogowana liczy na konto', async () => {
    fakeSession.identity = null;
    expect(await updateCompany(OTHER, { name: 'Firma' })).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    expect(checkRateLimit).not.toHaveBeenCalled();

    resetFakeDb({ id: USER, role: 'employer' });
    vi.mocked(checkRateLimit).mockResolvedValueOnce(false);
    expect(await updateCompany(OTHER, { name: 'Firma' })).toEqual({ ok: false, error: 'RATE_LIMITED' });
    expect(vi.mocked(checkRateLimit).mock.calls[0]).toEqual([
      'company-update',
      expect.objectContaining({ identifier: USER, perIp: false }),
    ]);
  });

  it('odwołanie autora decyzji: limit na konto po sesji', async () => {
    fakeSession.identity = null;
    expect(await submitModerationAppeal(DECISION, 'x'.repeat(40), KEY)).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    expect(checkRateLimit).not.toHaveBeenCalled();
  });
});

describe('walidacja identyfikatorów (#1109)', () => {
  beforeEach(() => resetFakeDb({ id: USER, role: 'admin' }));

  it('zły format identyfikatora = VALIDATION_FAILED bez zapytania do bazy', async () => {
    expect(await setCompanyStatus('nie-uuid', 'verified', 'pending')).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(await resolveReport('1; drop', 'resolved', 'open')).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(await markNotificationsRead(['abc'])).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('kontrola ujemna: poprawny UUID trafia do RPC; brak listy powiadomień = „oznacz wszystkie”', async () => {
    fakeDb.rpc('admin_set_company_status', null).rpc('mark_notifications_read', 3);
    expect(await setCompanyStatus(OTHER, 'verified', 'pending')).toEqual({ ok: true });
    expect(await markNotificationsRead()).toEqual({ ok: true, count: 3 });
    expect(await markNotificationsRead([OTHER])).toEqual({ ok: true, count: 3 });
    expect(fakeDb.callsTo('mark_notifications_read')).toHaveLength(2);
  });
});

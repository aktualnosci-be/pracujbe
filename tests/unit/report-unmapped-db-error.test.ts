import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { inviteTeamMember } from '@/lib/actions/team';
import { reportUnmappedDbError } from '@/lib/db/errors';
import { setErrorReporter, type ErrorReport } from '@/lib/error-report';
import { getActiveCompany } from '@/lib/company-context';
import { checkRateLimit } from '@/lib/rate-limit';
import { fakeDb, pgError, resetFakeDb } from '../helpers/fake-db';

/**
 * #1068: nieoczekiwany błąd bazy (SQLSTATE spoza znanej listy) w Server Actions nie kończy się
 * już cichym INTERNAL — trafia do kanału błędów z obszarem i SQLSTATE, bez komunikatu bazy.
 */

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/company-context', async () => {
  const actual = await vi.importActual<typeof import('@/lib/company-context')>('@/lib/company-context');
  const getActiveCompany = vi.fn();
  return {
    ACTIVE_COMPANY_COOKIE: 'pb_active_company',
    getActiveCompany,
    getExpectedActiveCompany: async (tx: never, userId: string, expected: unknown) =>
      actual.matchExpectedCompany(await getActiveCompany(tx, userId), expected),
  };
});
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn() }));

const USER = '8e6b3d7a-5c7f-4f4b-8d69-4c0e5f2a1b34';
const COMPANY = '7d5a2c6f-4b6e-4e3a-9c58-3b9d4e1f0a23';
const SECRET_ROW = 'Failing row contains (kandydat@example.com, 12345)';

const reports: ErrorReport[] = [];

beforeEach(() => {
  reports.length = 0;
  setErrorReporter((r) => reports.push(r));
  resetFakeDb({ id: USER, role: 'employer' });
  vi.mocked(checkRateLimit).mockResolvedValue(true);
  vi.mocked(getActiveCompany).mockResolvedValue({ activeId: COMPANY, activeRole: 'owner' } as never);
});
afterEach(() => setErrorReporter(null));

describe('reportUnmappedDbError', () => {
  it('INTERNAL z błędu bazy → zgłoszenie z obszarem i SQLSTATE, bez komunikatu', () => {
    const error = pgError('42P01', SECRET_ROW);
    expect(reportUnmappedDbError(error, 'x.y', 'INTERNAL')).toBe('INTERNAL');
    expect(reports).toEqual([{ code: 'INTERNAL', area: 'x.y', sqlstate: '42P01' }]);
    expect(JSON.stringify(reports)).not.toContain('example.com');
  });

  it('kontrole ujemne: znany kod użytkowy i błąd spoza bazy nie są zgłaszane tu', () => {
    expect(reportUnmappedDbError(pgError('P0001', 'NOT_FOUND'), 'x.y', 'NOT_FOUND')).toBe('NOT_FOUND');
    expect(reportUnmappedDbError(new Error('sieć'), 'x.y', 'INTERNAL')).toBe('INTERNAL');
    expect(reports).toEqual([]);
  });
});

describe('akcje zespołu (#1068)', () => {
  it('nieznany SQLSTATE w RPC → INTERNAL dla użytkownika + wpis w kanale błędów', async () => {
    fakeDb.rpc('invite_company_member', () => {
      throw pgError('XX000', SECRET_ROW);
    });
    const result = await inviteTeamMember({ email: 'a@b.be', role: 'member', locale: 'pl' }, COMPANY);
    expect(result).toEqual({ ok: false, error: 'INTERNAL' });
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ code: 'INTERNAL', sqlstate: 'XX000' });
    expect(reports[0]!.area).toMatch(/^team\./);
    expect(JSON.stringify(reports)).not.toContain('example.com');
  });

  it('kontrola ujemna: znany błąd biznesowy (MEMBER_ALREADY_EXISTS) nie trafia do kanału', async () => {
    fakeDb.rpc('invite_company_member', () => {
      throw pgError('P0001', 'MEMBER_ALREADY_EXISTS');
    });
    const result = await inviteTeamMember({ email: 'a@b.be', role: 'member', locale: 'pl' }, COMPANY);
    expect(result).toEqual({ ok: false, error: 'MEMBER_ALREADY_EXISTS' });
    expect(reports).toEqual([]);
  });
});

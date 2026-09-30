import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setContactMessageStatus } from '@/lib/actions/admin';
import { deleteJobDraft } from '@/lib/actions/jobs';
import { markNotificationsRead } from '@/lib/actions/notifications';
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

describe('dokończenie #1068: oferty i pozostałe akcje poza trybem rekrutacyjnym', () => {
  const JOB = '5c4b1e5d-3a5f-4d29-8b47-2a8c3d0e9f12';

  it('oferty: nieznany SQLSTATE → INTERNAL + wpis z obszarem akcji i SQLSTATE, bez komunikatu bazy', async () => {
    fakeDb.rows('jobs.delete-draft-state', () => {
      throw pgError('42703', SECRET_ROW);
    });
    const result = await deleteJobDraft(JOB);
    expect(result).toEqual({ ok: false, error: 'INTERNAL' });
    expect(reports).toEqual([{ code: 'INTERNAL', area: 'jobs.deleteJobDraft', sqlstate: '42703' }]);
    expect(JSON.stringify(reports)).not.toContain('example.com');
  });

  it('oferty: wyjątek spoza bazy (sieć) też trafia do kanału, dawniej był cichym INTERNAL', async () => {
    fakeDb.rows('jobs.delete-draft-state', () => {
      throw new Error('connect ECONNREFUSED');
    });
    expect(await deleteJobDraft(JOB)).toEqual({ ok: false, error: 'INTERNAL' });
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ area: 'jobs.deleteJobDraft' });
  });

  it('kontrola ujemna: znany błąd biznesowy oferty (MODERATION_LOCKED) nie trafia do kanału', async () => {
    fakeDb.rows('jobs.delete-draft-state', () => {
      throw pgError('P0001', 'MODERATION_LOCKED');
    });
    expect(await deleteJobDraft(JOB)).toEqual({ ok: false, error: 'MODERATION_LOCKED' });
    expect(reports).toEqual([]);
  });

  it('powiadomienia: nieznany SQLSTATE → wpis; znany (PERMISSION_DENIED) → bez wpisu', async () => {
    fakeDb.rpc('mark_notifications_read', () => {
      throw pgError('53300', SECRET_ROW);
    });
    expect(await markNotificationsRead()).toEqual({ ok: false, error: 'INTERNAL' });
    expect(reports).toEqual([{ code: 'INTERNAL', area: 'notifications.markNotificationsRead', sqlstate: '53300' }]);

    reports.length = 0;
    fakeDb.rpc('mark_notifications_read', () => {
      throw pgError('42501', 'new row violates row-level security policy');
    });
    expect(await markNotificationsRead()).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    expect(reports).toEqual([]);
  });

  it('panel admina: nieznany SQLSTATE w RPC → wpis; STALE_STATE → bez wpisu', async () => {
    resetFakeDb({ id: USER, role: 'admin' });
    fakeDb.rpc('admin_set_contact_message_status', () => {
      throw pgError('XX000', SECRET_ROW);
    });
    const failed = await setContactMessageStatus(JOB, 'handled', 'new');
    expect(failed).toEqual({ ok: false, error: 'INTERNAL' });
    expect(reports).toEqual([{ code: 'INTERNAL', area: 'admin.setContactMessageStatus', sqlstate: 'XX000' }]);

    reports.length = 0;
    fakeDb.rpc('admin_set_contact_message_status', () => {
      throw pgError('P0001', 'STALE_STATE');
    });
    expect(await setContactMessageStatus(JOB, 'handled', 'new')).toEqual({ ok: false, error: 'STALE_STATE' });
    expect(reports).toEqual([]);
  });
});

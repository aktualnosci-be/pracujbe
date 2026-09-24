import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCompanyModerationDecisions, getMyCompany } from '@/lib/data/company';
import { getActiveCompany } from '@/lib/company-context';
import { captureError } from '@/lib/sentry';
import { fakeDb, fakeSession, pgError, resetFakeDb } from '../helpers/fake-db';

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/company-context', () => ({ getActiveCompany: vi.fn() }));
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));

const USER = '11111111-1111-4111-8111-111111111111';

function db(rows: unknown[] | (() => unknown[])) {
  fakeDb.rows('company.my-company', typeof rows === 'function' ? rows : () => rows);
}

beforeEach(() => {
  vi.resetAllMocks();
  resetFakeDb({ id: USER, role: 'employer' });
  vi.mocked(getActiveCompany).mockResolvedValue({
    activeId: 'company-1',
    activeRole: 'owner',
  } as never);
});

describe('company read state', () => {
  it('keeps database failures distinct from a missing company', async () => {
    const failure = pgError('08006', 'DATABASE_UNAVAILABLE');
    db(() => {
      throw failure;
    });
    expect(await getMyCompany()).toEqual({ status: 'error' });
    // Zapytanie zawężone do sesji i aktywnej firmy z kontekstu.
    expect(fakeDb.callsTo('company.my-company')[0]).toMatchObject({ as: USER, values: [USER, 'company-1'] });
    expect(captureError).toHaveBeenCalledWith(failure, {
      area: 'company.getMyCompany',
    });
  });

  it('allows creation only when active membership is absent', async () => {
    db([]);
    vi.mocked(getActiveCompany).mockResolvedValue({
      activeId: null,
      activeRole: 'member',
    } as never);
    expect(await getMyCompany()).toEqual({ status: 'ok', company: null });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('returns the company after a successful RLS read', async () => {
    db([
      {
        id: 'company-1',
        name: 'Acme',
        slug: 'acme',
        status: 'pending',
        vat_number: null,
        verified_at: null,
      },
    ]);
    expect(await getMyCompany()).toEqual({
      status: 'ok',
      company: {
        id: 'company-1',
        name: 'Acme',
        slug: 'acme',
        status: 'pending',
        vatNumber: null,
        verifiedAt: null,
        statusReason: null,
        canEdit: true,
      },
    });
  });

  it('shows the admin reason only for rejected/suspended companies', async () => {
    db([{ id: 'company-1', name: 'Acme', status: 'rejected', status_reason: ' Brak KBO ' }]);
    expect(await getMyCompany()).toMatchObject({ company: { statusReason: 'Brak KBO' } });
  });

  it('does not treat missing auth data as a company-free account', async () => {
    db([]);
    fakeSession.identity = null;
    expect(await getMyCompany()).toEqual({ status: 'error' });
    expect(fakeDb.calls).toHaveLength(0);
    expect(getActiveCompany).not.toHaveBeenCalled();
  });

  it('does not treat a failed membership lookup as no company', async () => {
    db([]);
    vi.mocked(getActiveCompany).mockRejectedValue(
      new Error('membership read failed'),
    );
    expect(await getMyCompany()).toEqual({ status: 'error' });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('does not treat an unreadable active company row as no company', async () => {
    db([]);
    expect(await getMyCompany()).toEqual({ status: 'error' });
  });

  it('does not allow a regular member to edit company data', async () => {
    db([{ id: 'company-1', name: 'Acme' }]);
    vi.mocked(getActiveCompany).mockResolvedValue({
      activeId: 'company-1',
      activeRole: 'member',
    } as never);
    expect(await getMyCompany()).toMatchObject({
      status: 'ok',
      company: { canEdit: false },
    });
  });

  it('returns the demo company without backend configuration', async () => {
    fakeSession.configured = false;
    expect(await getMyCompany()).toMatchObject({ status: 'ok', company: { id: 'demo-company' } });
    expect(fakeDb.calls).toHaveLength(0);
  });
});

describe('company moderation decisions', () => {
  it('maps RPC rows read under the session', async () => {
    fakeDb.rpc('get_company_moderation_decisions', [
      { id: 'd1', reference: 'DEC-1', decision: 'job_removed', job_title: 'Magazynier', facts: 'F',
        ground_type: 'terms', ground_reference: '§3', automated_detection: false,
        decided_at: '2026-09-01T10:00:00Z', restored_at: null, restore_reason: null },
    ]);
    expect(await getCompanyModerationDecisions('company-1')).toEqual({
      status: 'ok',
      decisions: [{
        id: 'd1', reference: 'DEC-1', decision: 'job_removed', jobTitle: 'Magazynier', facts: 'F',
        groundType: 'terms', groundReference: '§3', automatedDetection: false,
        decidedAt: '2026-09-01T10:00:00Z', restoredAt: null, restoreReason: null,
      }],
    });
    expect(fakeDb.callsTo('get_company_moderation_decisions')[0]).toMatchObject({
      kind: 'rpcrows', as: USER, args: { p_company_id: 'company-1' },
    });
  });

  it('reports failures and guests as an error', async () => {
    fakeDb.rpc('get_company_moderation_decisions', () => {
      throw pgError('XX000', 'boom');
    });
    expect(await getCompanyModerationDecisions('company-1')).toEqual({ status: 'error' });
    fakeSession.identity = null;
    expect(await getCompanyModerationDecisions('company-1')).toEqual({ status: 'error' });
  });
});

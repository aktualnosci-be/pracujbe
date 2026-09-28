import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCompanyById, getCompanyModerationDecisions, getMyCompany } from '@/lib/data/company';
import { getActiveCompany } from '@/lib/company-context';
import { captureError } from '@/lib/error-report';
import { fakeDb, fakeSession, pgError, resetFakeDb } from '../helpers/fake-db';

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/company-context', () => ({ getActiveCompany: vi.fn() }));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

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
        website: 'https://acme.example',
        logo_url: null,
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
        website: 'https://acme.example',
        logoUrl: null,
        linksReview: null,
        agency: { isAgency: false, recognitionNumber: null, checkStatus: 'unchecked' },
        canEdit: true,
      },
    });
  });

  it('exposes a pending links proposal separately from the published addresses (0156)', async () => {
    db([{
      id: 'company-1', name: 'Acme', status: 'verified', website: 'https://acme.example',
      website_pending: 'https://nowa.acme.example', logo_url_pending: null,
      links_review_status: 'pending', links_pending_at: '2026-09-26 10:00:00.123+00',
      links_review_reason: null,
    }]);
    expect(await getMyCompany()).toMatchObject({
      company: {
        website: 'https://acme.example',
        linksReview: {
          status: 'pending',
          website: 'https://nowa.acme.example',
          logoUrl: null,
          submittedAt: '2026-09-26 10:00:00.123+00',
          reason: null,
        },
      },
    });
  });

  it('negative control: an unknown review status is not treated as a proposal', async () => {
    db([{ id: 'company-1', name: 'Acme', status: 'verified', links_review_status: 'approved',
          website_pending: 'https://x.example' }]);
    expect(await getMyCompany()).toMatchObject({ company: { linksReview: null } });
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

// #843: odczyt KONKRETNEJ firmy po id — niezależnie od aktywnej firmy z cookie (`getActiveCompany`
// nie jest tu w ogóle wołane). Link decyzji (e-mail/powiadomienie) musi pokazać dane firmy,
// której dotyczy, a nie ciszej podstawiać aktywną firmę wywołującego.
describe('getCompanyById (#843) — firma z linku decyzji, niezależnie od aktywnej', () => {
  function byIdDb(rows: unknown[] | (() => unknown[])) {
    fakeDb.rows('company.by-id', typeof rows === 'function' ? rows : () => rows);
  }

  it('reads the requested company by membership, ignoring the active-company cookie', async () => {
    byIdDb([
      {
        id: 'company-2',
        name: 'Company B',
        slug: 'company-b',
        status: 'suspended',
        status_reason: 'Suspension reason for B',
        vat_number: null,
        verified_at: null,
        website: null,
        logo_url: null,
        role: 'owner',
      },
    ]);
    expect(await getCompanyById('company-2')).toEqual({
      status: 'ok',
      company: {
        id: 'company-2',
        name: 'Company B',
        slug: 'company-b',
        status: 'suspended',
        vatNumber: null,
        verifiedAt: null,
        statusReason: 'Suspension reason for B',
        website: null,
        logoUrl: null,
        linksReview: null,
        agency: { isAgency: false, recognitionNumber: null, checkStatus: 'unchecked' },
        canEdit: true,
      },
    });
    // Zapytanie zawężone do sesji i DOKŁADNIE żądanej firmy — nie do aktywnej z cookie.
    expect(fakeDb.callsTo('company.by-id')[0]).toMatchObject({ as: USER, values: [USER, 'company-2'] });
    expect(getActiveCompany).not.toHaveBeenCalled();
  });

  it('a removed/foreign company gives an explicit "not_found", never another company\'s data', async () => {
    byIdDb([]);
    expect(await getCompanyById('company-9')).toEqual({ status: 'not_found' });
  });

  it('hides the status reason unless the company is rejected/suspended', async () => {
    byIdDb([{ id: 'company-2', name: 'B', status: 'verified', status_reason: 'stale', role: 'member' }]);
    expect(await getCompanyById('company-2')).toMatchObject({ company: { statusReason: null, canEdit: false } });
  });

  it('a database failure is distinct from "not found"', async () => {
    const failure = pgError('08006', 'DATABASE_UNAVAILABLE');
    byIdDb(() => {
      throw failure;
    });
    expect(await getCompanyById('company-2')).toEqual({ status: 'error' });
    expect(captureError).toHaveBeenCalledWith(failure, { area: 'company.getCompanyById' });
  });

  it('without backend configuration there is no per-company demo data', async () => {
    fakeSession.configured = false;
    expect(await getCompanyById('company-2')).toEqual({ status: 'not_found' });
    expect(fakeDb.calls).toHaveLength(0);
  });

  // KONTROLA UJEMNA (#843): przed poprawką jedynym sposobem odczytu firmy było `getMyCompany`
  // (zawsze AKTYWNA z cookie) — ten test byłby czerwony bez nowej, niezależnej ścieżki odczytu.
  it('KONTROLA UJEMNA: reading a non-active company does not require it to be active', async () => {
    byIdDb([{ id: 'company-2', name: 'B', status: 'suspended', status_reason: 'x', role: 'owner' }]);
    vi.mocked(getActiveCompany).mockResolvedValue({ activeId: 'company-1', activeRole: 'owner' } as never);
    const result = await getCompanyById('company-2');
    expect(result.status).toBe('ok');
    expect(getActiveCompany).not.toHaveBeenCalled();
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
        // #43: bez pól odwołania w wierszu — brak drogi i brak własnego odwołania.
        appealState: null, appealDeadline: null, appeal: null,
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

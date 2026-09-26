import { beforeEach, describe, expect, it, vi } from 'vitest';
import { updateCompanyLinks } from '@/lib/actions/company';
import { getActiveCompany } from '@/lib/company-context';
import { checkRateLimit } from '@/lib/rate-limit';
import { fakeDb, pgError, resetFakeDb } from '../helpers/fake-db';

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/company-context', () => ({
  ACTIVE_COMPANY_COOKIE: 'pb_active_company',
  getActiveCompany: vi.fn(),
}));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn() }));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

const USER = '11111111-1111-4111-8111-111111111111';

function db(rows: unknown[] | (() => never)) {
  fakeDb.exec('company.update-links', typeof rows === 'function' ? rows : () => ({ rows }));
}

beforeEach(() => {
  vi.resetAllMocks();
  resetFakeDb({ id: USER, role: 'employer' });
  vi.mocked(checkRateLimit).mockResolvedValue(true);
  vi.mocked(getActiveCompany).mockResolvedValue({
    activeId: 'company-1',
    activeRole: 'owner',
  } as never);
});

describe('company links update authorization', () => {
  it('rejects a regular member before writing', async () => {
    db([{ id: 'company-1' }]);
    vi.mocked(getActiveCompany).mockResolvedValue({
      activeId: 'company-1',
      activeRole: 'member',
    } as never);
    expect(await updateCompanyLinks({ website: 'https://acme.example' })).toEqual({
      ok: false,
      error: 'PERMISSION_DENIED',
    });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('does not claim success when RLS updates zero rows', async () => {
    db([]);
    expect(await updateCompanyLinks({ website: 'https://acme.example' })).toEqual({
      ok: false,
      error: 'PERMISSION_DENIED',
    });
  });

  it('accepts a confirmed update by an owner, scoped to the active company', async () => {
    db([{ id: 'company-1' }]);
    expect(await updateCompanyLinks({ website: 'https://acme.example' })).toEqual({ ok: true });
    // Tylko website: logo_url nie jest nadpisywany (flaga false).
    expect(fakeDb.callsTo('company.update-links')[0]).toMatchObject({
      as: USER,
      values: ['company-1', true, 'https://acme.example', false, null],
    });
  });

  it('an admin may also save the links', async () => {
    db([{ id: 'company-1' }]);
    vi.mocked(getActiveCompany).mockResolvedValue({
      activeId: 'company-1',
      activeRole: 'admin',
    } as never);
    expect(await updateCompanyLinks({ logoUrl: 'https://acme.example/logo.png' })).toEqual({ ok: true });
  });

  it('empty values clear the fields; empty input writes nothing', async () => {
    db([{ id: 'company-1' }]);
    expect(await updateCompanyLinks({ website: '', logoUrl: '' })).toEqual({ ok: true });
    expect(fakeDb.callsTo('company.update-links')[0]?.values).toEqual([
      'company-1', true, null, true, null,
    ]);
    expect(await updateCompanyLinks({})).toEqual({ ok: true });
    expect(fakeDb.callsTo('company.update-links')).toHaveLength(1);
  });

  it('rejects a non-https address before touching the database', async () => {
    expect(await updateCompanyLinks({ website: 'http://acme.example' })).toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
    });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('maps a CHECK/RLS rejection from the database to a user code', async () => {
    db(() => {
      throw pgError('23514', 'new row for relation "companies" violates check constraint "companies_website_https"');
    });
    expect(await updateCompanyLinks({ website: 'https://acme.example' })).toEqual({
      ok: false,
      error: 'INTERNAL',
    });
  });

  it('never returns reverificationRequired (links never affect verification)', async () => {
    db([{ id: 'company-1' }]);
    vi.mocked(getActiveCompany).mockResolvedValue({
      activeId: 'company-1',
      activeRole: 'owner',
      activeStatus: 'verified',
    } as never);
    expect(await updateCompanyLinks({ website: 'https://acme.example' })).toEqual({ ok: true });
  });

  it('reports pendingReview when the database moved the new address to review (0207)', async () => {
    db([{ id: 'company-1', website_pending: 'https://acme.example', logo_url_pending: null }]);
    expect(await updateCompanyLinks({ website: 'https://acme.example' })).toEqual({
      ok: true,
      pendingReview: true,
    });
    // Wpis adresu zeruje też zgłoszenie (adres równy zatwierdzonemu = anulowanie zgłoszenia).
    expect(fakeDb.callsTo('company.update-links')[0]?.text).toMatch(/website_pending\s*=\s*CASE WHEN \$2 THEN NULL/);
  });

  it('does not report pendingReview for a field the user did not submit (negative control)', async () => {
    // Zaległe zgłoszenie strony WWW nie dotyczy zapisu samego logo.
    db([{ id: 'company-1', website_pending: 'https://old.example', logo_url_pending: null }]);
    expect(await updateCompanyLinks({ logoUrl: '' })).toEqual({ ok: true });
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { updateCompany } from '@/lib/actions/company';
import { getActiveCompany } from '@/lib/company-context';
import { checkRateLimit } from '@/lib/rate-limit';
import { fakeDb, pgError, resetFakeDb } from '../helpers/fake-db';

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/company-context', () => ({
  ACTIVE_COMPANY_COOKIE: 'pb_active_company',
  getActiveCompany: vi.fn(),
}));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn() }));
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));

const USER = '11111111-1111-4111-8111-111111111111';

function db(rows: unknown[] | (() => never)) {
  fakeDb.exec('company.update', typeof rows === 'function' ? rows : () => ({ rows }));
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

describe('company update authorization', () => {
  it('rejects a regular member before writing', async () => {
    db([{ id: 'company-1' }]);
    vi.mocked(getActiveCompany).mockResolvedValue({
      activeId: 'company-1',
      activeRole: 'member',
    } as never);
    expect(await updateCompany({ name: 'Acme' })).toEqual({
      ok: false,
      error: 'PERMISSION_DENIED',
    });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('does not claim success when RLS updates zero rows', async () => {
    db([]);
    expect(await updateCompany({ name: 'Acme' })).toEqual({
      ok: false,
      error: 'PERMISSION_DENIED',
    });
    expect(fakeDb.callsTo('company.update')[0]?.text).toMatch(/RETURNING id, status/);
  });

  it('accepts one confirmed update by an owner, scoped to the active company', async () => {
    db([{ id: 'company-1' }]);
    expect(await updateCompany({ name: 'Acme' })).toEqual({ ok: true });
    // Tylko nazwa: VAT nie jest nadpisywany (flaga false), UPDATE pod sesją użytkownika.
    expect(fakeDb.callsTo('company.update')[0]).toMatchObject({
      as: USER,
      values: ['company-1', true, 'Acme', false, null],
    });
  });

  it('empty VAT clears the value; empty input writes nothing', async () => {
    db([{ id: 'company-1' }]);
    expect(await updateCompany({ vatNumber: '' })).toEqual({ ok: true });
    expect(fakeDb.callsTo('company.update')[0]?.values).toEqual(['company-1', false, null, true, null]);
    expect(await updateCompany({})).toEqual({ ok: true });
    expect(fakeDb.callsTo('company.update')).toHaveLength(1);
  });

  it('maps an RLS/trigger rejection to a user code', async () => {
    db(() => {
      throw pgError('42501', 'PERMISSION_DENIED: status/weryfikacja firmy tylko przez backend/admina');
    });
    expect(await updateCompany({ name: 'Acme' })).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
  });

  it('informuje, gdy zmiana danych zweryfikowanej firmy wraca do weryfikacji', async () => {
    vi.mocked(getActiveCompany).mockResolvedValue({
      activeId: 'company-1',
      activeRole: 'owner',
      activeStatus: 'verified',
    } as never);
    db([{ id: 'company-1', status: 'pending' }]);
    expect(await updateCompany({ name: 'Acme Nowa' })).toEqual({
      ok: true,
      reverificationRequired: true,
    });
  });

  it('bez zmiany statusu nie zgłasza ponownej weryfikacji', async () => {
    vi.mocked(getActiveCompany).mockResolvedValue({
      activeId: 'company-1',
      activeRole: 'owner',
      activeStatus: 'verified',
    } as never);
    db([{ id: 'company-1', status: 'verified' }]);
    expect(await updateCompany({ name: 'Acme' })).toEqual({ ok: true });
  });
});

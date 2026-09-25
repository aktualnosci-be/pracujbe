import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCompany, requestCompanyReverification } from '@/lib/actions/company';
import { getActiveCompany } from '@/lib/company-context';
import { checkRateLimit } from '@/lib/rate-limit';
import { fakeDb, fakeSession, pgError, resetFakeDb } from '../helpers/fake-db';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/company-context', () => ({
  ACTIVE_COMPANY_COOKIE: 'pb_active_company',
  getActiveCompany: vi.fn(),
}));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn() }));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

const USER = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  vi.resetAllMocks();
  resetFakeDb({ id: USER, role: 'employer' });
  vi.mocked(checkRateLimit).mockResolvedValue(true);
  vi.mocked(getActiveCompany).mockResolvedValue({
    activeId: 'company-1',
    activeRole: 'owner',
    activeStatus: 'rejected',
  } as never);
});

describe('createCompany — firma i VAT w jednej transakcji (#368, #365)', () => {
  it('przekazuje VAT do RPC zamiast osobnego UPDATE (pod sesją)', async () => {
    fakeDb.rpc('create_first_company', [{ company_id: 'company-9', created: true }]);
    expect(await createCompany({ name: 'Acme Logistics', vatNumber: 'BE0123456789' })).toEqual({
      ok: true,
      id: 'company-9',
    });
    const [call] = fakeDb.callsTo('create_first_company');
    expect(call).toMatchObject({
      kind: 'rpcrows',
      as: USER,
      args: { p_name: 'Acme Logistics', p_vat_number: 'BE0123456789' },
    });
    expect(fakeDb.calls.filter((c) => c.kind === 'exec')).toHaveLength(0);
  });

  it('nieudany zapis (np. VAT) nie daje sukcesu', async () => {
    fakeDb.rpc('create_first_company', () => {
      throw pgError('23514', 'new row violates check constraint "companies_vat_len"');
    });
    expect(await createCompany({ name: 'Acme Logistics', vatNumber: 'BE0123456789' })).toEqual({
      ok: false,
      error: 'INTERNAL',
    });
  });

  it('ponowne kliknięcie zwraca istniejącą firmę bez duplikatu', async () => {
    fakeDb.rpc('create_first_company', [{ company_id: 'company-9', created: false }]);
    expect(await createCompany({ name: 'Acme Logistics' })).toEqual({ ok: true, id: 'company-9' });
  });

  it('pusta odpowiedź RPC to błąd, nie sukces', async () => {
    fakeDb.rpc('create_first_company', []);
    expect(await createCompany({ name: 'Acme Logistics' })).toEqual({ ok: false, error: 'INTERNAL' });
  });

  it('bez sesji — brak wywołania RPC; bez backendu — demo', async () => {
    fakeSession.identity = null;
    expect(await createCompany({ name: 'Acme Logistics' })).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    fakeSession.configured = false;
    expect(await createCompany({ name: 'Acme Logistics' })).toEqual({ ok: true, id: 'demo-company', demo: true });
    expect(fakeDb.calls).toHaveLength(0);
  });
});

describe('requestCompanyReverification (#400)', () => {
  it('zwykły member nie wywołuje RPC', async () => {
    vi.mocked(getActiveCompany).mockResolvedValue({
      activeId: 'company-1',
      activeRole: 'member',
    } as never);
    expect(await requestCompanyReverification()).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    expect(fakeDb.callsTo('request_company_reverification')).toHaveLength(0);
  });

  it('zgłasza aktywną firmę owner-a', async () => {
    fakeDb.rpc('request_company_reverification', null);
    expect(await requestCompanyReverification()).toEqual({ ok: true });
    expect(fakeDb.callsTo('request_company_reverification')[0]?.args).toEqual({
      p_company_id: 'company-1',
    });
  });

  it('stan inny niż odrzucony mapuje na INVALID_TRANSITION', async () => {
    fakeDb.rpc('request_company_reverification', () => {
      throw pgError('42501', 'COMPANY_STATUS_INVALID');
    });
    expect(await requestCompanyReverification()).toEqual({ ok: false, error: 'INVALID_TRANSITION' });
  });

  it('limit prób zatrzymuje przed zapisem', async () => {
    vi.mocked(checkRateLimit).mockResolvedValue(false);
    expect(await requestCompanyReverification()).toEqual({ ok: false, error: 'RATE_LIMITED' });
    expect(fakeDb.calls).toHaveLength(0);
  });
});

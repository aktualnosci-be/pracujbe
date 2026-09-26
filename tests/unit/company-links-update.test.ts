import { beforeEach, describe, expect, it, vi } from 'vitest';
import { updateCompanyLinks } from '@/lib/actions/company';
import { getActiveCompany } from '@/lib/company-context';
import { checkRateLimit } from '@/lib/rate-limit';
import { fakeDb, pgError, resetFakeDb } from '../helpers/fake-db';

/**
 * Zgłoszenie strony WWW/logo firmy (#112, od 0204 z zatwierdzaniem przez admina): akcja woła
 * wyłącznie RPC `submit_company_links` pod sesją (bez bezpośredniego UPDATE kolumn — blokuje go
 * strażnik w bazie), przekazuje tylko ustawione pola i zwraca wynik RPC (`pending`/`applied`/
 * `unchanged`); nieoczekiwany wynik nie udaje sukcesu.
 */

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/company-context', () => ({
  ACTIVE_COMPANY_COOKIE: 'pb_active_company',
  getActiveCompany: vi.fn(),
}));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn() }));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const USER = '11111111-1111-4111-8111-111111111111';

function submit(result: unknown | (() => never)) {
  fakeDb.rpc('submit_company_links', typeof result === 'function' ? result : () => result);
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

describe('company links submission (review by admin, 0204)', () => {
  it('rejects a regular member before writing', async () => {
    submit('pending');
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

  it('a new address goes to the admin queue (outcome pending), scoped to the active company', async () => {
    submit('pending');
    expect(await updateCompanyLinks({ website: 'https://acme.example' })).toEqual({
      ok: true,
      outcome: 'pending',
    });
    // Tylko website: logo bez zmian (flaga false). Brak bezpośredniego UPDATE kolumn.
    const [call] = fakeDb.callsTo('submit_company_links');
    expect(call).toMatchObject({ as: USER });
    expect(call?.args).toEqual({
      p_company_id: 'company-1',
      p_set_website: true,
      p_website: 'https://acme.example',
      p_set_logo_url: false,
      p_logo_url: null,
    });
    expect(fakeDb.callsTo('company.update-links')).toHaveLength(0);
  });

  it('an admin of the company may also submit; removal is applied immediately', async () => {
    submit('applied');
    vi.mocked(getActiveCompany).mockResolvedValue({
      activeId: 'company-1',
      activeRole: 'admin',
    } as never);
    expect(await updateCompanyLinks({ website: '', logoUrl: '' })).toEqual({
      ok: true,
      outcome: 'applied',
    });
    expect(fakeDb.callsTo('submit_company_links')[0]?.args).toMatchObject({
      p_set_website: true,
      p_website: '',
      p_set_logo_url: true,
      p_logo_url: '',
    });
  });

  it('empty input writes nothing', async () => {
    expect(await updateCompanyLinks({})).toEqual({ ok: true, outcome: 'unchanged' });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('rejects a non-https address before touching the database', async () => {
    expect(await updateCompanyLinks({ website: 'http://acme.example' })).toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
    });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('maps database rejections to user codes', async () => {
    submit(() => {
      throw pgError('42501', 'PERMISSION_DENIED: strona WWW i logo — tylko owner/admin firmy');
    });
    expect(await updateCompanyLinks({ website: 'https://acme.example' })).toEqual({
      ok: false,
      error: 'PERMISSION_DENIED',
    });
    submit(() => {
      throw pgError('22023', 'VALIDATION_FAILED: WEBSITE_INVALID');
    });
    expect(await updateCompanyLinks({ website: 'https://acme.example' })).toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
    });
  });

  it('negative control: an unexpected RPC result is not reported as success', async () => {
    submit(null);
    expect(await updateCompanyLinks({ website: 'https://acme.example' })).toEqual({
      ok: false,
      error: 'INTERNAL',
    });
  });
});

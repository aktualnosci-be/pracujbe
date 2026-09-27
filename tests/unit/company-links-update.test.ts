import { beforeEach, describe, expect, it, vi } from 'vitest';
import { updateCompanyLinks } from '@/lib/actions/company';
import { checkRateLimit } from '@/lib/rate-limit';
import { fakeDb, pgError, resetFakeDb } from '../helpers/fake-db';

/**
 * Zgłoszenie strony WWW/logo firmy WSKAZANEJ przez `companyId` (#112, #801, od 0156 z
 * zatwierdzaniem przez admina): akcja pyta o rolę/status TYLKO dla `companyId` przekazanego
 * z formularza (nigdy o aktywną firmę z cookie) i woła wyłącznie RPC `submit_company_links`
 * pod sesją (bez bezpośredniego UPDATE kolumn — blokuje go strażnik w bazie), przekazuje
 * tylko ustawione pola i zwraca wynik RPC (`pending`/`applied`/`unchanged`); nieoczekiwany
 * wynik nie udaje sukcesu.
 */

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn() }));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const USER = '11111111-1111-4111-8111-111111111111';
const COMPANY_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_COMPANY_ID = '33333333-3333-4333-8333-333333333333';

function submit(result: unknown | (() => never)) {
  fakeDb.rpc('submit_company_links', typeof result === 'function' ? result : () => result);
}

/**
 * Członkostwo zwracane przez `getCompanyMembershipFor` — akcja pyta o rolę/status TYLKO dla
 * `companyId` przekazanego z formularza (#801), nigdy o aktywną firmę z cookie.
 */
function membership(role: string, status = 'unverified') {
  fakeDb.rows('company.membership-for-company', () => [{ role, status }]);
}

function noMembership() {
  fakeDb.rows('company.membership-for-company', () => []);
}

beforeEach(() => {
  vi.resetAllMocks();
  resetFakeDb({ id: USER, role: 'employer' });
  vi.mocked(checkRateLimit).mockResolvedValue(true);
  membership('owner');
});

describe('company links submission (scoped to companyId, review by admin, 0156)', () => {
  it('rejects an invalid company id before touching the database', async () => {
    expect(await updateCompanyLinks('not-a-uuid', { website: 'https://acme.example' })).toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('rejects a regular member before writing', async () => {
    submit('pending');
    membership('member');
    expect(await updateCompanyLinks(COMPANY_ID, { website: 'https://acme.example' })).toEqual({
      ok: false,
      error: 'PERMISSION_DENIED',
    });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('rejects a company the user is not an active member of (#801: stale form after switching company)', async () => {
    noMembership();
    expect(
      await updateCompanyLinks(OTHER_COMPANY_ID, { website: 'https://acme.example' }),
    ).toEqual({ ok: false, error: 'NOT_FOUND' });
    expect(fakeDb.callsTo('submit_company_links')).toHaveLength(0);
  });

  it('a new address goes to the admin queue (outcome pending), scoped to the company from the form', async () => {
    submit('pending');
    expect(await updateCompanyLinks(COMPANY_ID, { website: 'https://acme.example' })).toEqual({
      ok: true,
      outcome: 'pending',
    });
    // Tylko website: logo bez zmian (flaga false). Brak bezpośredniego UPDATE kolumn.
    const [call] = fakeDb.callsTo('submit_company_links');
    expect(call).toMatchObject({ as: USER });
    expect(call?.args).toEqual({
      p_company_id: COMPANY_ID,
      p_set_website: true,
      p_website: 'https://acme.example',
      p_set_logo_url: false,
      p_logo_url: null,
    });
  });

  it('an admin of the company may also submit; removal is applied immediately', async () => {
    submit('applied');
    membership('admin');
    expect(await updateCompanyLinks(COMPANY_ID, { website: '', logoUrl: '' })).toEqual({
      ok: true,
      outcome: 'applied',
    });
    expect(fakeDb.callsTo('submit_company_links')[0]?.args).toMatchObject({
      p_company_id: COMPANY_ID,
      p_set_website: true,
      p_website: '',
      p_set_logo_url: true,
      p_logo_url: '',
    });
  });

  it('empty input writes nothing', async () => {
    expect(await updateCompanyLinks(COMPANY_ID, {})).toEqual({ ok: true, outcome: 'unchanged' });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('rejects a non-https address before touching the database', async () => {
    expect(await updateCompanyLinks(COMPANY_ID, { website: 'http://acme.example' })).toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
    });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('maps database rejections to user codes', async () => {
    submit(() => {
      throw pgError('42501', 'PERMISSION_DENIED: strona WWW i logo — tylko owner/admin firmy');
    });
    expect(await updateCompanyLinks(COMPANY_ID, { website: 'https://acme.example' })).toEqual({
      ok: false,
      error: 'PERMISSION_DENIED',
    });
    submit(() => {
      throw pgError('22023', 'VALIDATION_FAILED: WEBSITE_INVALID');
    });
    expect(await updateCompanyLinks(COMPANY_ID, { website: 'https://acme.example' })).toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
    });
  });

  it('negative control: an unexpected RPC result is not reported as success', async () => {
    submit(null);
    expect(await updateCompanyLinks(COMPANY_ID, { website: 'https://acme.example' })).toEqual({
      ok: false,
      error: 'INTERNAL',
    });
  });

  it('never returns reverificationRequired (links never affect verification)', async () => {
    submit('pending');
    membership('owner', 'verified');
    expect(await updateCompanyLinks(COMPANY_ID, { website: 'https://acme.example' })).toEqual({
      ok: true,
      outcome: 'pending',
    });
  });

  it('#801: nie zapisuje do innej firmy niż ta, dla której wyrenderowano formularz', async () => {
    // Formularz otwarty dla COMPANY_ID; aktywna firma w cookie mogła się zmienić w innej
    // karcie na OTHER_COMPANY_ID między renderem a wysłaniem — zapis musi trafić do
    // COMPANY_ID, nigdy do aktywnej firmy z cookie.
    submit('pending');
    expect(await updateCompanyLinks(COMPANY_ID, { website: 'https://acme.example' })).toEqual({
      ok: true,
      outcome: 'pending',
    });
    expect(fakeDb.callsTo('company.membership-for-company')[0]?.values).toEqual([USER, COMPANY_ID]);
    expect(fakeDb.callsTo('submit_company_links')[0]?.args).toMatchObject({
      p_company_id: COMPANY_ID,
    });
  });
});

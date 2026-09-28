import { beforeEach, describe, expect, it, vi } from 'vitest';
import { updateCompany } from '@/lib/actions/company';
import { checkRateLimit } from '@/lib/rate-limit';
import { fakeDb, fakeSession, pgError, resetFakeDb } from '../helpers/fake-db';

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn() }));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

const USER = '11111111-1111-4111-8111-111111111111';
const COMPANY_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_COMPANY_ID = '33333333-3333-4333-8333-333333333333';

function db(rows: unknown[] | (() => never)) {
  fakeDb.exec('company.update', typeof rows === 'function' ? rows : () => ({ rows }));
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

describe('company update authorization', () => {
  it('rejects an invalid company id before touching the database', async () => {
    expect(await updateCompany('not-a-uuid', { name: 'Acme' })).toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('rejects a regular member before writing', async () => {
    db([{ id: COMPANY_ID }]);
    membership('member');
    expect(await updateCompany(COMPANY_ID, { name: 'Acme' })).toEqual({
      ok: false,
      error: 'PERMISSION_DENIED',
    });
    expect(fakeDb.callsTo('company.update')).toHaveLength(0);
  });

  it('rejects a company the user is not an active member of (#801: stale form after switching company)', async () => {
    db([{ id: OTHER_COMPANY_ID }]);
    noMembership();
    // Formularz był wyrenderowany dla OTHER_COMPANY_ID, ale użytkownik nie ma już (albo nigdy
    // nie miał) aktywnego członkostwa w tej firmie — niezależnie od tego, co wskazuje cookie
    // aktywnej firmy w innej karcie.
    expect(await updateCompany(OTHER_COMPANY_ID, { name: 'Acme' })).toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
    expect(fakeDb.callsTo('company.update')).toHaveLength(0);
  });

  it('does not claim success when RLS updates zero rows', async () => {
    db([]);
    expect(await updateCompany(COMPANY_ID, { name: 'Acme' })).toEqual({
      ok: false,
      error: 'PERMISSION_DENIED',
    });
    expect(fakeDb.callsTo('company.update')[0]?.text).toMatch(/RETURNING id, status/);
  });

  it('accepts one confirmed update by an owner, scoped to the company from the form', async () => {
    db([{ id: COMPANY_ID }]);
    expect(await updateCompany(COMPANY_ID, { name: 'Acme' })).toEqual({ ok: true });
    // Tylko nazwa: VAT nie jest nadpisywany (flaga false), UPDATE pod sesją użytkownika.
    expect(fakeDb.callsTo('company.update')[0]).toMatchObject({
      as: USER,
      values: [COMPANY_ID, true, 'Acme', false, null],
    });
  });

  it('empty VAT clears the value; empty input writes nothing', async () => {
    db([{ id: COMPANY_ID }]);
    expect(await updateCompany(COMPANY_ID, { vatNumber: '' })).toEqual({ ok: true });
    expect(fakeDb.callsTo('company.update')[0]?.values).toEqual([COMPANY_ID, false, null, true, null]);
    expect(await updateCompany(COMPANY_ID, {})).toEqual({ ok: true });
    expect(fakeDb.callsTo('company.update')).toHaveLength(1);
  });

  it('maps an RLS/trigger rejection to a user code', async () => {
    db(() => {
      throw pgError('42501', 'PERMISSION_DENIED: status/weryfikacja firmy tylko przez backend/admina');
    });
    expect(await updateCompany(COMPANY_ID, { name: 'Acme' })).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
  });

  it('informuje, gdy zmiana danych zweryfikowanej firmy wraca do weryfikacji', async () => {
    membership('owner', 'verified');
    db([{ id: COMPANY_ID, status: 'pending' }]);
    expect(await updateCompany(COMPANY_ID, { name: 'Acme Nowa' })).toEqual({
      ok: true,
      reverificationRequired: true,
    });
  });

  it('bez zmiany statusu nie zgłasza ponownej weryfikacji', async () => {
    membership('owner', 'verified');
    db([{ id: COMPANY_ID, status: 'verified' }]);
    expect(await updateCompany(COMPANY_ID, { name: 'Acme' })).toEqual({ ok: true });
  });

  it('demo (bez bazy): identyfikator demonstracyjny nie jest UUID i nie dostaje NOT_FOUND', async () => {
    // `DEMO_COMPANY.id` = 'demo-company' (bez bazy nie ma prawdziwych UUID) — bramka demo musi
    // być sprawdzana PRZED walidacją formatu UUID, inaczej panel demonstracyjny dostaje
    // NOT_FOUND zamiast komunikatu demo.
    fakeSession.configured = false;
    expect(await updateCompany('demo-company', { name: 'Acme' })).toEqual({ ok: true, demo: true });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('#801: nie zapisuje do innej firmy niż ta, dla której wyrenderowano formularz', async () => {
    // Formularz otwarty dla COMPANY_ID; użytkownik jest ownerem OBU firm, ale przełączył
    // aktywną firmę na OTHER_COMPANY_ID w innej karcie MIĘDZY renderem a wysłaniem. Zapis
    // musi trafić do COMPANY_ID (z formularza), nigdy do aktywnej firmy z cookie.
    fakeDb.exec('company.update', ({ values }) => {
      expect(values[0]).toBe(COMPANY_ID);
      return { rows: [{ id: COMPANY_ID, status: 'unverified' }] };
    });
    expect(await updateCompany(COMPANY_ID, { name: 'Acme' })).toEqual({ ok: true });
    expect(fakeDb.callsTo('company.membership-for-company')[0]?.values).toEqual([USER, COMPANY_ID]);
  });
});

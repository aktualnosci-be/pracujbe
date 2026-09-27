import { beforeEach, describe, expect, it, vi } from 'vitest';
import { updateCompanyLinks } from '@/lib/actions/company';
import { checkRateLimit } from '@/lib/rate-limit';
import { fakeDb, pgError, resetFakeDb } from '../helpers/fake-db';

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn() }));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

const USER = '11111111-1111-4111-8111-111111111111';
const COMPANY_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_COMPANY_ID = '33333333-3333-4333-8333-333333333333';

function db(rows: unknown[] | (() => never)) {
  fakeDb.exec('company.update-links', typeof rows === 'function' ? rows : () => ({ rows }));
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

describe('company links update authorization', () => {
  it('rejects an invalid company id before touching the database', async () => {
    expect(await updateCompanyLinks('not-a-uuid', { website: 'https://acme.example' })).toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('rejects a regular member before writing', async () => {
    db([{ id: COMPANY_ID }]);
    membership('member');
    expect(await updateCompanyLinks(COMPANY_ID, { website: 'https://acme.example' })).toEqual({
      ok: false,
      error: 'PERMISSION_DENIED',
    });
    expect(fakeDb.callsTo('company.update-links')).toHaveLength(0);
  });

  it('rejects a company the user is not an active member of (#801: stale form after switching company)', async () => {
    db([{ id: OTHER_COMPANY_ID }]);
    noMembership();
    expect(
      await updateCompanyLinks(OTHER_COMPANY_ID, { website: 'https://acme.example' }),
    ).toEqual({ ok: false, error: 'NOT_FOUND' });
    expect(fakeDb.callsTo('company.update-links')).toHaveLength(0);
  });

  it('does not claim success when RLS updates zero rows', async () => {
    db([]);
    expect(await updateCompanyLinks(COMPANY_ID, { website: 'https://acme.example' })).toEqual({
      ok: false,
      error: 'PERMISSION_DENIED',
    });
  });

  it('accepts a confirmed update by an owner, scoped to the company from the form', async () => {
    db([{ id: COMPANY_ID }]);
    expect(await updateCompanyLinks(COMPANY_ID, { website: 'https://acme.example' })).toEqual({ ok: true });
    // Tylko website: logo_url nie jest nadpisywany (flaga false).
    expect(fakeDb.callsTo('company.update-links')[0]).toMatchObject({
      as: USER,
      values: [COMPANY_ID, true, 'https://acme.example', false, null],
    });
  });

  it('an admin may also save the links', async () => {
    db([{ id: COMPANY_ID }]);
    membership('admin');
    expect(await updateCompanyLinks(COMPANY_ID, { logoUrl: 'https://acme.example/logo.png' })).toEqual({ ok: true });
  });

  it('empty values clear the fields; empty input writes nothing', async () => {
    db([{ id: COMPANY_ID }]);
    expect(await updateCompanyLinks(COMPANY_ID, { website: '', logoUrl: '' })).toEqual({ ok: true });
    expect(fakeDb.callsTo('company.update-links')[0]?.values).toEqual([
      COMPANY_ID, true, null, true, null,
    ]);
    expect(await updateCompanyLinks(COMPANY_ID, {})).toEqual({ ok: true });
    expect(fakeDb.callsTo('company.update-links')).toHaveLength(1);
  });

  it('rejects a non-https address before touching the database', async () => {
    expect(await updateCompanyLinks(COMPANY_ID, { website: 'http://acme.example' })).toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
    });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('maps a CHECK/RLS rejection from the database to a user code', async () => {
    db(() => {
      throw pgError('23514', 'new row for relation "companies" violates check constraint "companies_website_https"');
    });
    expect(await updateCompanyLinks(COMPANY_ID, { website: 'https://acme.example' })).toEqual({
      ok: false,
      error: 'INTERNAL',
    });
  });

  it('never returns reverificationRequired (links never affect verification)', async () => {
    db([{ id: COMPANY_ID }]);
    membership('owner', 'verified');
    expect(await updateCompanyLinks(COMPANY_ID, { website: 'https://acme.example' })).toEqual({ ok: true });
  });

  it('#801: nie zapisuje do innej firmy niż ta, dla której wyrenderowano formularz', async () => {
    // Formularz otwarty dla COMPANY_ID; aktywna firma w cookie mogła się zmienić w innej
    // karcie na OTHER_COMPANY_ID między renderem a wysłaniem — zapis musi trafić do
    // COMPANY_ID, nigdy do aktywnej firmy z cookie.
    fakeDb.exec('company.update-links', ({ values }) => {
      expect(values[0]).toBe(COMPANY_ID);
      return { rows: [{ id: COMPANY_ID }] };
    });
    expect(await updateCompanyLinks(COMPANY_ID, { website: 'https://acme.example' })).toEqual({ ok: true });
    expect(fakeDb.callsTo('company.membership-for-company')[0]?.values).toEqual([USER, COMPANY_ID]);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getUserDetail } from '@/lib/data/admin';
import { fakeDb, fakeSession, pgError, resetFakeDb } from '../helpers/fake-db';

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

// Szczegół konta w panelu admina (`/admin/uzytkownicy/[id]`): odczyt service-rolem tylko po
// potwierdzeniu roli admina, język komunikacji wg Invariantu #1, jawne stany not_found/error.

const ADMIN = { id: '00000000-0000-4000-8000-00000000a001', role: 'admin' } as const;
const USER = '00000000-0000-4000-8000-00000000c001';
const COMPANY = '00000000-0000-4000-8000-00000000f001';

function profile(overrides: Record<string, unknown> = {}) {
  return {
    id: USER,
    first_name: 'Karel',
    last_name: 'Kandidaat',
    email: 'karel@example.invalid',
    role: 'candidate',
    preferred_locale: null,
    account_locale: 'nl',
    signup_locale: 'fr',
    is_active: true,
    last_seen_at: '2026-09-20T08:00:00.000000+00:00',
    created_at: '2026-01-02T10:00:00.000000+00:00',
    ...overrides,
  };
}

function seed(overrides: Record<string, unknown> = {}) {
  fakeDb
    .rows('admin.user-detail', [profile(overrides)])
    .rows('admin.user-memberships', [
      {
        id: 'm1',
        role: 'recruiter',
        is_active: false,
        joined_at: null,
        created_at: '2026-02-01T10:00:00+00:00',
        company_id: COMPANY,
        company_name: 'Firma IT',
        company_status: 'verified',
      },
    ])
    .rows('admin.user-candidate', [{ profile_completed: true, is_searchable: false }])
    .count('admin.user-applications', 3)
    .count('admin.user-offers', 1)
    .rows('admin.user-suppression', [{ reason: 'complaint', created_at: '2026-03-01T10:00:00+00:00' }]);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetFakeDb({ ...ADMIN });
});

describe('getUserDetail — dostęp', () => {
  it('brak sesji → notFound, bez zapytań', async () => {
    fakeSession.identity = null;
    await expect(getUserDetail(USER)).rejects.toThrow('NEXT_NOT_FOUND');
    expect(fakeDb.calls).toHaveLength(0);
  });

  it.each(['candidate', 'employer'] as const)('rola %s → notFound, bez zapytań', async (role) => {
    fakeSession.identity = { id: '00000000-0000-4000-8000-00000000e001', role };
    await expect(getUserDetail(USER)).rejects.toThrow('NEXT_NOT_FOUND');
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('admin: wszystkie odczyty przez service_role, identyfikator w parametrze', async () => {
    seed();
    await getUserDetail(USER);
    expect(fakeDb.calls.length).toBeGreaterThan(0);
    expect(fakeDb.calls.every((call) => call.as === 'service')).toBe(true);
    expect(fakeDb.callsTo('admin.user-detail')[0]?.values).toEqual([USER]);
    expect(fakeDb.callsTo('admin.user-detail')[0]?.text).toContain('deleted_at IS NULL');
  });
});

describe('getUserDetail — dane', () => {
  it('konto kandydata: firmy, liczniki, blokada adresu', async () => {
    seed();
    const result = await getUserDetail(USER);
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.user).toMatchObject({
      id: USER,
      name: 'Karel Kandidaat',
      email: 'karel@example.invalid',
      role: 'candidate',
      isActive: true,
      lastSeenAt: '2026-09-20T08:00:00.000000+00:00',
      memberships: [
        {
          companyId: COMPANY,
          companyName: 'Firma IT',
          companyStatus: 'verified',
          role: 'recruiter',
          isActive: false,
          since: '2026-02-01T10:00:00+00:00',
        },
      ],
      candidate: { profileCompleted: true, isSearchable: false, applications: 3, offers: 1 },
      suppression: { reason: 'complaint', createdAt: '2026-03-01T10:00:00+00:00' },
    });
    // Blokada szukana po adresie profilu (citext), tylko aktywna.
    const suppression = fakeDb.callsTo('admin.user-suppression')[0]!;
    expect(suppression.values).toEqual(['karel@example.invalid']);
    expect(suppression.text).toContain('lifted_at IS NULL');
  });

  it('język komunikacji = fallback Invariantu #1 (brak preferred → account_locale)', async () => {
    seed();
    const result = await getUserDetail(USER);
    expect(result.status === 'ok' && result.user.recipientLocale).toBe('nl');
  });

  it('język komunikacji: preferred wygrywa; brak wszystkich → en (kontrola ujemna: nie język sesji admina)', async () => {
    seed({ preferred_locale: 'fr', account_locale: 'pl' });
    const preferred = await getUserDetail(USER);
    expect(preferred.status === 'ok' && preferred.user.recipientLocale).toBe('fr');

    resetFakeDb({ ...ADMIN });
    seed({ preferred_locale: null, account_locale: null, signup_locale: null });
    const none = await getUserDetail(USER);
    expect(none.status === 'ok' && none.user.recipientLocale).toBe('en');
  });

  it('konto bez profilu kandydata i bez e-maila: brak liczników i brak zapytania o blokadę', async () => {
    fakeDb
      .rows('admin.user-detail', [profile({ role: 'employer', email: null })])
      .rows('admin.user-memberships', [])
      .rows('admin.user-candidate', []);
    const result = await getUserDetail(USER);
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.user.candidate).toBeNull();
    expect(result.user.suppression).toBeNull();
    expect(fakeDb.callsTo('admin.user-applications')).toHaveLength(0);
    expect(fakeDb.callsTo('admin.user-suppression')).toHaveLength(0);
  });

  it('zły identyfikator → not_found bez zapytań', async () => {
    await expect(getUserDetail('nie-uuid')).resolves.toEqual({ status: 'not_found' });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('konto nieistniejące/usunięte → not_found', async () => {
    fakeDb.rows('admin.user-detail', []);
    await expect(getUserDetail(USER)).resolves.toEqual({ status: 'not_found' });
  });

  it('błąd dowolnego odczytu → error (bez częściowych danych)', async () => {
    seed();
    fakeDb.count('admin.user-offers', () => {
      throw pgError('XX000', 'boom');
    });
    await expect(getUserDetail(USER)).resolves.toEqual({ status: 'error' });
  });
});

describe('getUserDetail — tryb demo', () => {
  it('bez bazy: konto demo z firmą; nieznane id → not_found', async () => {
    fakeSession.configured = false;
    const demo = await getUserDetail('demo-u3');
    expect(demo).toMatchObject({ status: 'ok', user: { role: 'employer', memberships: [{ role: 'owner' }] } });
    await expect(getUserDetail('demo-x')).resolves.toEqual({ status: 'not_found' });
    expect(fakeDb.calls).toHaveLength(0);
  });
});

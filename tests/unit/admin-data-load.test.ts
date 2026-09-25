import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ADMIN_PAGE_SIZE, decodeAdminCursor } from '@/lib/admin/list-params';
import {
  getAdminStats,
  listAuditLogs,
  listCompanies,
  listReports,
  listUsers,
} from '@/lib/data/admin';
import { fakeDb, fakeSession, pgError, resetFakeDb, type FakeCall } from '../helpers/fake-db';

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));

const ADMIN = { id: '00000000-0000-4000-8000-00000000a001', role: 'admin' } as const;

/** Wywołania service_role (transakcja `withServiceRole`). */
function serviceCalls(): FakeCall[] {
  return fakeDb.calls.filter((call) => call.as === 'service');
}

/** Pusta odpowiedź dla każdego zapytania listy (bez danych pomocniczych). */
function emptyList(name: string) {
  fakeDb.rows(name, []);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetFakeDb({ ...ADMIN });
});

describe('panel admina — odczyt service-role tylko po potwierdzeniu roli', () => {
  const loaders = [
    ['getAdminStats', () => getAdminStats()],
    ['listCompanies', () => listCompanies()],
    ['listReports', () => listReports()],
    ['listUsers', () => listUsers()],
    ['listAuditLogs', () => listAuditLogs()],
  ] as const;

  it.each(loaders)('%s: brak sesji → notFound, bez zapytań service-role', async (_name, load) => {
    fakeSession.identity = null;
    await expect(load()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(fakeDb.calls).toHaveLength(0);
  });

  it.each(loaders)('%s: rola inna niż admin → notFound, bez zapytań service-role', async (_name, load) => {
    fakeSession.identity = { id: '00000000-0000-4000-8000-00000000e001', role: 'employer' };
    await expect(load()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(fakeDb.calls).toHaveLength(0);
  });

  it.each(loaders)('%s: błąd odczytu tożsamości → notFound (fail closed)', async (_name, load) => {
    const portal = await import('@/lib/db/portal');
    vi.spyOn(portal, 'getPortalIdentity').mockRejectedValueOnce(new Error('boom'));
    await expect(load()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('admin: odczyty idą przez service_role, nie pod sesją', async () => {
    emptyList('admin.users');
    await listUsers();
    expect(fakeDb.calls.map((c) => c.as)).toEqual(['service']);
  });
});

describe('panel admina — błąd odczytu nie udaje pustej listy (#311)', () => {
  it.each([
    ['listCompanies', () => listCompanies(), 'admin.companies'],
    ['listReports', () => listReports(), 'admin.reports'],
    ['listUsers', () => listUsers(), 'admin.users'],
    ['listAuditLogs', () => listAuditLogs(), 'admin.audit-logs'],
  ] as const)('%s: błąd zapytania → status error', async (_name, load, query) => {
    fakeDb.rows(query, () => {
      throw pgError('XX000', 'boom');
    });
    await expect(load()).resolves.toEqual({ status: 'error' });
  });

  it('listReports: błąd odczytu nazw zgłaszających → status error', async () => {
    fakeDb
      .rows('admin.reports', [{ id: 'r1', reporter_id: 'u1', status: 'open' }])
      .rows('admin.report-reporters', () => {
        throw pgError('XX000', 'boom');
      });
    await expect(listReports()).resolves.toEqual({ status: 'error' });
  });

  it('pusta lista z bazy to status ok z pustymi wierszami', async () => {
    emptyList('admin.users');
    await expect(listUsers()).resolves.toEqual({ status: 'ok', rows: [], nextCursor: null });
  });

  it('getAdminStats: błąd pojedynczego licznika → status error (nie zera)', async () => {
    fakeDb
      .count('admin.stats-companies', 5)
      .count('admin.stats-pending-companies', () => {
        throw pgError('XX000', 'boom');
      })
      .count('admin.stats-users', 10)
      .count('admin.stats-open-reports', 1);
    await expect(getAdminStats()).resolves.toEqual({ status: 'error' });
  });
});

describe('panel admina — kolejka weryfikacji firm (#307)', () => {
  it('licznik „Oczekujące” obejmuje statusy unverified i pending', async () => {
    fakeDb
      .count('admin.stats-companies', 5)
      .count('admin.stats-pending-companies', 3)
      .count('admin.stats-users', 10)
      .count('admin.stats-open-reports', 1);
    await expect(getAdminStats()).resolves.toEqual({
      status: 'ok',
      stats: { companies: 5, pendingCompanies: 3, users: 10, openReports: 1 },
    });
    expect(fakeDb.callsTo('admin.stats-pending-companies')[0]?.values).toEqual([['unverified', 'pending']]);
  });

  it('filtr `awaiting` listy firm filtruje unverified + pending', async () => {
    fakeDb.rows('admin.companies', [{ id: 'c1', name: 'A', status: 'unverified', vat_number: 'BE1' }]);
    const result = await listCompanies({ status: 'awaiting' });
    const call = fakeDb.callsTo('admin.companies')[0]!;
    expect(call.text).toContain('status::text = ANY($1::text[])');
    expect(call.values[0]).toEqual(['unverified', 'pending']);
    expect(result).toMatchObject({ status: 'ok', rows: [{ id: 'c1', vatNumber: 'BE1' }] });
  });
});

/* ---------------------------------------------------------------------------
 * #418: stronicowanie kursorem i wyszukiwanie po stronie serwera
 * ------------------------------------------------------------------------- */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Wartość parametru `$n` użytego w tekście zapytania po danym fragmencie SQL. */
function paramAfter(call: { text: string; values: unknown[] }, fragment: RegExp): unknown {
  const match = fragment.exec(call.text);
  return match ? call.values[Number(match[1]) - 1] : undefined;
}

/**
 * „Baza” użytkowników (część z RÓWNĄ datą utworzenia), którą atrapa filtruje tak jak
 * PostgreSQL: warunek kursora `(created_at, id) < ($a, $b)`, sortowanie `created_at desc,
 * id desc`, `LIMIT $n`.
 */
function pagedProfiles(total: number) {
  const all = Array.from({ length: total }, (_, i) => ({
    id: uuid(i + 1),
    role: 'candidate',
    // Co 10 wierszy ta sama data — kursor musi rozstrzygać po `id`.
    created_at: `2026-01-${String(1 + Math.floor(i / 10)).padStart(2, '0')}T10:00:00.123456+00:00`,
  }));
  return (call: { text: string; values: unknown[] }) => {
    let rows = [...all];
    const cursor = /\(created_at, id\) < \(\$(\d+)::timestamptz, \$(\d+)::uuid\)/.exec(call.text);
    if (cursor) {
      const ts = call.values[Number(cursor[1]) - 1] as string;
      const id = call.values[Number(cursor[2]) - 1] as string;
      rows = rows.filter((r) => r.created_at < ts || (r.created_at === ts && r.id < id));
    }
    rows.sort((a, b) =>
      a.created_at === b.created_at ? (a.id < b.id ? 1 : -1) : a.created_at < b.created_at ? 1 : -1,
    );
    const limit = paramAfter(call, /LIMIT \$(\d+)/) as number;
    return rows.slice(0, limit);
  };
}

describe('panel admina — stronicowanie kursorem (#418)', () => {
  it('201+ rekordów: dojście do ostatniego bez duplikatów i pominięć', async () => {
    const total = 205;
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    fakeDb.rows('admin.users', pagedProfiles(total));
    do {
      const result = await listUsers({ cursor });
      expect(result.status).toBe('ok');
      if (result.status !== 'ok') return;
      expect(result.rows.length).toBeLessThanOrEqual(ADMIN_PAGE_SIZE);
      seen.push(...result.rows.map((r) => r.id));
      cursor = result.nextCursor;
      pages += 1;
    } while (cursor && pages < 20);

    expect(seen).toHaveLength(total);
    expect(new Set(seen).size).toBe(total);
    expect(seen).toContain(uuid(1)); // najstarszy (201.+ pozycja) osiągalny
    expect(pages).toBe(Math.ceil(total / ADMIN_PAGE_SIZE));
  });

  it('kursor zachowuje znacznik czasu z mikrosekundami (bez utraty przez Date)', async () => {
    fakeDb.rows('admin.users', pagedProfiles(ADMIN_PAGE_SIZE + 1));
    const result = await listUsers();
    if (result.status !== 'ok') throw new Error('expected ok');
    const cursor = decodeAdminCursor(result.nextCursor);
    expect(cursor?.createdAt).toMatch(/\.123456\+00:00$/);
    // Ten sam znacznik trafia do parametru zapytania następnej strony.
    await listUsers({ cursor: result.nextCursor });
    const next = fakeDb.callsTo('admin.users')[1]!;
    expect(next.values).toContain(cursor?.createdAt);
  });

  it('kontrola ujemna: zmanipulowany kursor = pierwsza strona (bez warunku kursora)', async () => {
    emptyList('admin.users');
    await listUsers({ cursor: 'x' + "'),id.gt.0" });
    const call = fakeDb.callsTo('admin.users')[0]!;
    expect(call.text).not.toContain('(created_at, id) <');
    expect(call.values).toEqual([ADMIN_PAGE_SIZE + 1]);
  });

  it('wyszukiwanie, rola i kursor jako parametry (wartości nigdy w tekście SQL)', async () => {
    emptyList('admin.users');
    const cursor = 'MjAyNi0wMS0wMVQxMDowMDowMCswMDowMHwwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDE';
    await listUsers({ q: "Jan, (x)'; drop", role: 'employer', cursor });
    const call = fakeDb.callsTo('admin.users')[0]!;
    expect(call.text).toContain('first_name::text ILIKE $2 OR last_name::text ILIKE $2 OR email::text ILIKE $2');
    expect(call.text).toContain('(created_at, id) < ($3::timestamptz, $4::uuid)');
    expect(call.text).not.toContain('drop');
    expect(call.values).toEqual([
      'employer',
      "%Jan x '; drop%",
      '2026-01-01T10:00:00+00:00',
      '00000000-0000-4000-8000-000000000001',
      ADMIN_PAGE_SIZE + 1,
    ]);
  });

  it('`_` z frazy jest literałem LIKE, nie symbolem wieloznacznym', async () => {
    emptyList('admin.users');
    await listUsers({ q: 'jan_k' });
    expect(fakeDb.callsTo('admin.users')[0]?.values[0]).toBe('%jan\\_k%');
  });

  it('kontrola ujemna: nieznana rola (np. moderator) nie filtruje listy', async () => {
    emptyList('admin.users');
    await listUsers({ role: 'moderator' });
    expect(fakeDb.callsTo('admin.users')[0]?.text).not.toContain('role::text =');
  });

  it('firmy: wyszukiwanie obejmuje nazwę, VAT, KBO i e-mail', async () => {
    emptyList('admin.companies');
    await listCompanies({ q: 'BE0123' });
    const call = fakeDb.callsTo('admin.companies')[0]!;
    for (const col of ['name', 'vat_number', 'registration_number', 'email']) {
      expect(call.text).toContain(`${col}::text ILIKE $1`);
    }
    expect(call.values[0]).toBe('%BE0123%');
  });
});

describe('panel admina — zgłoszenia: filtr statusu i cel (#416)', () => {
  it('domyślny filtr = otwarte + w analizie', async () => {
    emptyList('admin.reports');
    await listReports();
    const call = fakeDb.callsTo('admin.reports')[0]!;
    expect(call.text).toContain('status::text = ANY($1::text[])');
    expect(call.values[0]).toEqual(['open', 'reviewing']);
  });

  it('filtr `all` bez ograniczenia statusu; nieznany → domyślny', async () => {
    emptyList('admin.reports');
    await listReports({ status: 'all' });
    await listReports({ status: 'drop table' });
    const [all, unknown] = fakeDb.callsTo('admin.reports');
    expect(all?.text).not.toContain('status::text');
    expect(unknown?.values[0]).toEqual(['open', 'reviewing']);
  });

  it('cel dla każdego target_type: link/podgląd, usunięty cel ma jawny stan', async () => {
    const report = (id: string, type: string, target: string) => ({
      id,
      reporter_id: null,
      target_type: type,
      target_id: target,
      reason: 'spam',
      status: 'open',
      created_at: '2026-01-01T10:00:00+00:00',
    });
    fakeDb
      .rows('admin.reports', [
        report('r1', 'job', 'j1'),
        report('r2', 'company', 'c1'),
        report('r3', 'user', 'u1'),
        report('r4', 'message', 'm1'),
        report('r5', 'job', 'j-gone'),
        report('r6', 'company', 'c-deleted'),
      ])
      .rows('admin.report-target-jobs', [
        { id: 'j1', title: 'Magazynier', slug: 'magazynier-gent', status: 'active' },
      ])
      .rows('admin.report-target-companies', [
        { id: 'c1', name: 'Firma A' },
        { id: 'c-deleted', name: 'Firma B', deleted_at: '2026-01-02T00:00:00Z' },
      ])
      .rows('admin.report-target-users', [
        { id: 'u1', first_name: 'Jan', last_name: 'Peeters', email: 'jan@example.com' },
      ])
      .rows('admin.report-target-messages', [{ id: 'm1', body: '  Treść\n wiadomości ' }]);

    const result = await listReports({ status: 'all' });
    if (result.status !== 'ok') throw new Error('expected ok');
    // Jeden batchowy odczyt na typ celu (bez N+1).
    expect(fakeDb.callsTo('admin.report-target-jobs')[0]?.values).toEqual([['j1', 'j-gone']]);
    const byId = Object.fromEntries(result.rows.map((r) => [r.id, r.target]));
    expect(byId.r1).toEqual({
      label: 'Magazynier',
      href: { pathname: '/oferty-pracy/magazynier-gent' },
      preview: null,
      deleted: false,
    });
    expect(byId.r2?.href).toEqual({ pathname: '/admin/firmy', query: { q: 'Firma A' } });
    expect(byId.r3).toMatchObject({
      label: 'Jan Peeters',
      href: { pathname: '/admin/uzytkownicy', query: { q: 'jan@example.com' } },
    });
    expect(byId.r4).toMatchObject({ preview: 'Treść wiadomości', href: null, deleted: false });
    expect(byId.r5).toMatchObject({ deleted: true, href: null });
    expect(byId.r6).toMatchObject({ deleted: true, href: null });
  });

  it('błąd odczytu celów → status error (nie rozstrzygamy na ślepo)', async () => {
    fakeDb
      .rows('admin.reports', [{ id: 'r1', target_type: 'job', target_id: 'j1', status: 'open' }])
      .rows('admin.report-target-jobs', () => {
        throw pgError('XX000', 'boom');
      });
    await expect(listReports()).resolves.toEqual({ status: 'error' });
  });
});

describe('panel admina — dziennik zdarzeń (#417)', () => {
  it('mapuje aktora, obiekt i zmianę statusu; system = brak aktora', async () => {
    fakeDb
      .rows('admin.audit-logs', [
        {
          id: 'a1',
          actor_id: 'admin-1',
          action: 'company.status_changed',
          entity_type: 'company',
          entity_id: 'c1',
          before_data: { status: 'pending' },
          after_data: { status: 'verified' },
          created_at: '2026-01-01T10:00:00+00:00',
        },
        {
          id: 'a2',
          actor_id: null,
          action: 'company.created',
          entity_type: 'company',
          entity_id: 'c2',
          before_data: null,
          after_data: { status: 'unverified', name: 'X' },
          created_at: '2026-01-01T09:00:00+00:00',
        },
      ])
      .rows('admin.audit-actors', [{ id: 'admin-1', first_name: 'Ada', last_name: 'Admin' }])
      .rows('admin.audit-companies', [
        { id: 'c1', name: 'Firma A' },
        { id: 'c2', name: 'Firma B', deleted_at: '2026-01-02T00:00:00Z' },
      ]);
    const result = await listAuditLogs();
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.rows[0]).toMatchObject({
      actorName: 'Ada Admin',
      entityLabel: 'Firma A',
      entityHref: { pathname: '/admin/firmy', query: { q: 'Firma A' } },
      statusBefore: 'pending',
      statusAfter: 'verified',
    });
    expect(result.rows[1]).toMatchObject({ actorId: null, entityLabel: 'Firma B', entityHref: null });
  });

  it('filtry: typ, akcja, obiekt, zakres dat w Europe/Brussels, aktor „system”', async () => {
    emptyList('admin.audit-logs');
    await listAuditLogs({
      entity: 'company',
      action: 'company.status_changed',
      entityId: '00000000-0000-4000-8000-000000000001',
      actor: 'system',
      from: '2025-07-01',
      to: '2025-07-01',
    });
    const call = fakeDb.callsTo('admin.audit-logs')[0]!;
    for (const fragment of [
      'entity_type = $1',
      'action = $2',
      'entity_id = $3::uuid',
      'created_at >= $4::timestamptz',
      'created_at < $5::timestamptz',
      'actor_id IS NULL',
    ]) {
      expect(call.text).toContain(fragment);
    }
    expect(call.values.slice(0, 5)).toEqual([
      'company',
      'company.status_changed',
      '00000000-0000-4000-8000-000000000001',
      '2025-06-30T22:00:00.000Z',
      '2025-07-01T22:00:00.000Z',
    ]);
    expect(fakeDb.callsTo('admin.audit-actor-search')).toHaveLength(0);
  });

  it('kontrola ujemna: nieznane wartości filtrów są ignorowane', async () => {
    emptyList('admin.audit-logs');
    await listAuditLogs({ entity: 'profiles', action: 'drop', entityId: 'nope', from: '2025-13-01' });
    const call = fakeDb.callsTo('admin.audit-logs')[0]!;
    expect(call.text).not.toMatch(/entity_type =|action =|entity_id =|created_at >=|created_at </);
    expect(call.values).toEqual([ADMIN_PAGE_SIZE + 1]);
  });

  it('aktor po nazwie: id dopasowanych profili filtrują dziennik', async () => {
    fakeDb.rows('admin.audit-actor-search', [{ id: 'p1' }, { id: 'p2' }]);
    emptyList('admin.audit-logs');
    await listAuditLogs({ actor: 'Ada' });
    expect(fakeDb.callsTo('admin.audit-actor-search')[0]?.values).toEqual(['%Ada%']);
    const call = fakeDb.callsTo('admin.audit-logs')[0]!;
    expect(call.text).toContain('actor_id = ANY($1::uuid[])');
    expect(call.values[0]).toEqual(['p1', 'p2']);
  });

  it('aktor po nazwie bez dopasowań → pusta lista bez odczytu audit_logs', async () => {
    emptyList('admin.audit-actor-search');
    await expect(listAuditLogs({ actor: 'Nikt' })).resolves.toEqual({
      status: 'ok',
      rows: [],
      nextCursor: null,
    });
    expect(fakeDb.callsTo('admin.audit-logs')).toHaveLength(0);
    expect(serviceCalls()).toHaveLength(1);
  });
});

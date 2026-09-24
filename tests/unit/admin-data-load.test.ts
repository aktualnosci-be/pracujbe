import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ADMIN_PAGE_SIZE, decodeAdminCursor } from '@/lib/admin/list-params';
import {
  getAdminStats,
  listAuditLogs,
  listCompanies,
  listReports,
  listUsers,
} from '@/lib/data/admin';
import { isSupabaseConfigured } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerClient } from '@/lib/supabase/server';

vi.mock('@/lib/env', () => ({ isSupabaseConfigured: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }));
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));

type Result = { data?: unknown; error?: unknown; count?: number | null };

/** Zapytanie-łańcuch Supabase: każdy filtr zwraca siebie, `await` daje `result(calls)`. */
function query(result: (calls: Array<[string, unknown[]]>) => Result) {
  const calls: Array<[string, unknown[]]> = [];
  const q: Record<string, unknown> = {};
  for (const method of ['select', 'is', 'eq', 'in', 'or', 'gte', 'lt', 'order', 'limit']) {
    q[method] = (...args: unknown[]) => {
      calls.push([method, args]);
      return q;
    };
  }
  q.then = (resolve: (value: Result) => unknown) => Promise.resolve(result(calls)).then(resolve);
  return { q, calls };
}

function mockClient(byTable: Record<string, Array<(calls: Array<[string, unknown[]]>) => Result>>) {
  const allCalls: Record<string, Array<Array<[string, unknown[]]>>> = {};
  const from = vi.fn((table: string) => {
    const next = byTable[table]?.shift();
    if (!next) throw new Error(`unexpected table ${table}`);
    const { q, calls } = query(next);
    (allCalls[table] ??= []).push(calls);
    return q;
  });
  vi.mocked(createAdminClient).mockReturnValue({ from } as never);
  return allCalls;
}

/** Sesja użytkownika (klient pod RLS): `user` z getUser i rola z własnego profilu. */
function mockSession(user: { id: string } | null, role: string | null, profileError?: unknown) {
  const single = { data: role ? { role } : null, error: profileError ?? null };
  const profileQuery = {
    select: () => profileQuery,
    eq: () => profileQuery,
    maybeSingle: () => Promise.resolve(single),
  };
  vi.mocked(createServerClient).mockResolvedValue({
    auth: { getUser: () => Promise.resolve({ data: { user } }) },
    from: vi.fn(() => profileQuery),
  } as never);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isSupabaseConfigured).mockReturnValue(true);
  mockSession({ id: 'admin-1' }, 'admin');
});

describe('panel admina — odczyt service-role tylko po potwierdzeniu roli', () => {
  const loaders = [
    ['getAdminStats', () => getAdminStats()],
    ['listCompanies', () => listCompanies()],
    ['listReports', () => listReports()],
    ['listUsers', () => listUsers()],
    ['listAuditLogs', () => listAuditLogs()],
  ] as const;

  it.each(loaders)('%s: brak sesji → notFound, bez klienta service-role', async (_name, load) => {
    mockSession(null, null);
    await expect(load()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it.each(loaders)('%s: rola inna niż admin → notFound, bez klienta service-role', async (_name, load) => {
    mockSession({ id: 'emp-1' }, 'employer');
    await expect(load()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it.each(loaders)('%s: błąd odczytu roli → notFound (fail closed)', async (_name, load) => {
    mockSession({ id: 'admin-1' }, null, { message: 'boom' });
    await expect(load()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});

describe('panel admina — błąd odczytu nie udaje pustej listy (#311)', () => {
  it.each([
    ['listCompanies', () => listCompanies(), 'companies'],
    ['listReports', () => listReports(), 'reports'],
    ['listUsers', () => listUsers(), 'profiles'],
    ['listAuditLogs', () => listAuditLogs(), 'audit_logs'],
  ] as const)('%s: błąd zapytania → status error', async (_name, load, table) => {
    mockClient({ [table]: [() => ({ data: null, error: { message: 'boom' } })] });
    await expect(load()).resolves.toEqual({ status: 'error' });
  });

  it('listReports: błąd odczytu nazw zgłaszających → status error', async () => {
    mockClient({
      reports: [() => ({ data: [{ id: 'r1', reporter_id: 'u1', status: 'open' }], error: null })],
      profiles: [() => ({ data: null, error: { message: 'boom' } })],
    });
    await expect(listReports()).resolves.toEqual({ status: 'error' });
  });

  it('pusta lista z bazy to status ok z pustymi wierszami', async () => {
    mockClient({ profiles: [() => ({ data: [], error: null })] });
    await expect(listUsers()).resolves.toEqual({ status: 'ok', rows: [], nextCursor: null });
  });

  it('getAdminStats: błąd pojedynczego licznika → status error (nie zera)', async () => {
    mockClient({
      companies: [() => ({ count: 5, error: null }), () => ({ count: null, error: { message: 'boom' } })],
      profiles: [() => ({ count: 10, error: null })],
      reports: [() => ({ count: 1, error: null })],
    });
    await expect(getAdminStats()).resolves.toEqual({ status: 'error' });
  });
});

describe('panel admina — kolejka weryfikacji firm (#307)', () => {
  it('licznik „Oczekujące” obejmuje statusy unverified i pending', async () => {
    const calls = mockClient({
      companies: [() => ({ count: 5, error: null }), () => ({ count: 3, error: null })],
      profiles: [() => ({ count: 10, error: null })],
      reports: [() => ({ count: 1, error: null })],
    });
    await expect(getAdminStats()).resolves.toEqual({
      status: 'ok',
      stats: { companies: 5, pendingCompanies: 3, users: 10, openReports: 1 },
    });
    expect(calls.companies?.[1]).toContainEqual(['in', ['status', ['unverified', 'pending']]]);
  });

  it('filtr `awaiting` listy firm filtruje unverified + pending', async () => {
    const calls = mockClient({
      companies: [() => ({ data: [{ id: 'c1', name: 'A', status: 'unverified', vat_number: 'BE1' }], error: null })],
    });
    const result = await listCompanies({ status: 'awaiting' });
    expect(calls.companies?.[0]).toContainEqual(['in', ['status', ['unverified', 'pending']]]);
    expect(result).toMatchObject({ status: 'ok', rows: [{ id: 'c1', vatNumber: 'BE1' }] });
  });
});

/* ---------------------------------------------------------------------------
 * #418: stronicowanie kursorem i wyszukiwanie po stronie serwera
 * ------------------------------------------------------------------------- */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/**
 * „Baza” 205 użytkowników (część z RÓWNĄ datą utworzenia), którą mock filtruje tak jak
 * PostgREST: warunek kursora z `.or()`, sortowanie `created_at desc, id desc`, `limit`.
 */
function pagedProfiles(total: number) {
  const all = Array.from({ length: total }, (_, i) => ({
    id: uuid(i + 1),
    role: 'candidate',
    // Co 10 wierszy ta sama data — kursor musi rozstrzygać po `id`.
    created_at: `2026-01-${String(1 + Math.floor(i / 10)).padStart(2, '0')}T10:00:00.123456+00:00`,
  }));
  return (calls: Array<[string, unknown[]]>) => {
    let rows = [...all];
    const or = calls.find(([m]) => m === 'or')?.[1][0] as string | undefined;
    if (or) {
      const m = /created_at\.lt\."([^"]+)",and\(created_at\.eq\."([^"]+)",id\.lt\.([0-9a-f-]+)\)/.exec(or);
      if (!m) throw new Error(`unexpected or: ${or}`);
      const [, ts, , id] = m;
      rows = rows.filter((r) => r.created_at < ts! || (r.created_at === ts && r.id < id!));
    }
    rows.sort((a, b) =>
      a.created_at === b.created_at ? (a.id < b.id ? 1 : -1) : a.created_at < b.created_at ? 1 : -1,
    );
    const limit = calls.find(([m]) => m === 'limit')?.[1][0] as number;
    return { data: rows.slice(0, limit), error: null };
  };
}

describe('panel admina — stronicowanie kursorem (#418)', () => {
  it('201+ rekordów: dojście do ostatniego bez duplikatów i pominięć', async () => {
    const total = 205;
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      mockClient({ profiles: [pagedProfiles(total)] });
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
    mockClient({ profiles: [pagedProfiles(ADMIN_PAGE_SIZE + 1)] });
    const result = await listUsers();
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(decodeAdminCursor(result.nextCursor)?.createdAt).toMatch(/\.123456\+00:00$/);
  });

  it('kontrola ujemna: zmanipulowany kursor = pierwsza strona (bez filtra kursora)', async () => {
    const calls = mockClient({ profiles: [() => ({ data: [], error: null })] });
    await listUsers({ cursor: 'x' + "'),id.gt.0" });
    expect(calls.profiles?.[0]?.some(([m]) => m === 'or')).toBe(false);
  });

  it('wyszukiwanie i kursor łączone w jeden parametr `or` (and(or(..),or(..)))', async () => {
    const calls = mockClient({ profiles: [() => ({ data: [], error: null })] });
    const cursor = 'MjAyNi0wMS0wMVQxMDowMDowMCswMDowMHwwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDE';
    await listUsers({ q: 'Jan, (x)', role: 'employer', cursor });
    const ors = calls.profiles?.[0]?.filter(([m]) => m === 'or') ?? [];
    expect(ors).toHaveLength(1);
    const filter = ors[0]![1][0] as string;
    expect(filter.startsWith('and(or(first_name.ilike."%Jan x%"')).toBe(true);
    expect(filter).toContain('or(created_at.lt.');
    expect(calls.profiles?.[0]).toContainEqual(['eq', ['role', 'employer']]);
  });

  it('kontrola ujemna: nieznana rola (np. moderator) nie filtruje listy', async () => {
    const calls = mockClient({ profiles: [() => ({ data: [], error: null })] });
    await listUsers({ role: 'moderator' });
    expect(calls.profiles?.[0]?.some(([m]) => m === 'eq')).toBe(false);
  });

  it('firmy: wyszukiwanie obejmuje nazwę, VAT, KBO i e-mail', async () => {
    const calls = mockClient({ companies: [() => ({ data: [], error: null })] });
    await listCompanies({ q: 'BE0123' });
    const filter = calls.companies?.[0]?.find(([m]) => m === 'or')?.[1][0] as string;
    for (const col of ['name', 'vat_number', 'registration_number', 'email']) {
      expect(filter).toContain(`${col}.ilike."%BE0123%"`);
    }
  });
});

describe('panel admina — zgłoszenia: filtr statusu i cel (#416)', () => {
  it('domyślny filtr = otwarte + w analizie', async () => {
    const calls = mockClient({ reports: [() => ({ data: [], error: null })] });
    await listReports();
    expect(calls.reports?.[0]).toContainEqual(['in', ['status', ['open', 'reviewing']]]);
  });

  it('filtr `all` bez ograniczenia statusu; nieznany → domyślny', async () => {
    const calls = mockClient({
      reports: [() => ({ data: [], error: null }), () => ({ data: [], error: null })],
    });
    await listReports({ status: 'all' });
    await listReports({ status: 'drop table' });
    expect(calls.reports?.[0]?.some(([m]) => m === 'in')).toBe(false);
    expect(calls.reports?.[1]).toContainEqual(['in', ['status', ['open', 'reviewing']]]);
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
    mockClient({
      reports: [
        () => ({
          data: [
            report('r1', 'job', 'j1'),
            report('r2', 'company', 'c1'),
            report('r3', 'user', 'u1'),
            report('r4', 'message', 'm1'),
            report('r5', 'job', 'j-gone'),
            report('r6', 'company', 'c-deleted'),
          ],
          error: null,
        }),
      ],
      jobs: [
        () => ({
          data: [{ id: 'j1', title: 'Magazynier', slug: 'magazynier-gent', status: 'active' }],
          error: null,
        }),
      ],
      companies: [
        () => ({
          data: [
            { id: 'c1', name: 'Firma A' },
            { id: 'c-deleted', name: 'Firma B', deleted_at: '2026-01-02T00:00:00Z' },
          ],
          error: null,
        }),
      ],
      profiles: [
        () => ({
          data: [{ id: 'u1', first_name: 'Jan', last_name: 'Peeters', email: 'jan@example.com' }],
          error: null,
        }),
      ],
      messages: [() => ({ data: [{ id: 'm1', body: '  Treść\n wiadomości ' }], error: null })],
    });

    const result = await listReports({ status: 'all' });
    if (result.status !== 'ok') throw new Error('expected ok');
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
    mockClient({
      reports: [
        () => ({
          data: [{ id: 'r1', target_type: 'job', target_id: 'j1', status: 'open' }],
          error: null,
        }),
      ],
      jobs: [() => ({ data: null, error: { message: 'boom' } })],
    });
    await expect(listReports()).resolves.toEqual({ status: 'error' });
  });
});

describe('panel admina — dziennik zdarzeń (#417)', () => {
  it('mapuje aktora, obiekt i zmianę statusu; system = brak aktora', async () => {
    mockClient({
      audit_logs: [
        () => ({
          data: [
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
          ],
          error: null,
        }),
      ],
      profiles: [() => ({ data: [{ id: 'admin-1', first_name: 'Ada', last_name: 'Admin' }], error: null })],
      companies: [
        () => ({
          data: [
            { id: 'c1', name: 'Firma A' },
            { id: 'c2', name: 'Firma B', deleted_at: '2026-01-02T00:00:00Z' },
          ],
          error: null,
        }),
      ],
    });
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
    const calls = mockClient({ audit_logs: [() => ({ data: [], error: null })] });
    await listAuditLogs({
      entity: 'company',
      action: 'company.status_changed',
      entityId: '00000000-0000-4000-8000-000000000001',
      actor: 'system',
      from: '2025-07-01',
      to: '2025-07-01',
    });
    const c = calls.audit_logs?.[0] ?? [];
    expect(c).toContainEqual(['eq', ['entity_type', 'company']]);
    expect(c).toContainEqual(['eq', ['action', 'company.status_changed']]);
    expect(c).toContainEqual(['eq', ['entity_id', '00000000-0000-4000-8000-000000000001']]);
    expect(c).toContainEqual(['is', ['actor_id', null]]);
    expect(c).toContainEqual(['gte', ['created_at', '2025-06-30T22:00:00.000Z']]);
    expect(c).toContainEqual(['lt', ['created_at', '2025-07-01T22:00:00.000Z']]);
  });

  it('kontrola ujemna: nieznane wartości filtrów są ignorowane', async () => {
    const calls = mockClient({ audit_logs: [() => ({ data: [], error: null })] });
    await listAuditLogs({ entity: 'profiles', action: 'drop', entityId: 'nope', from: '2025-13-01' });
    const c = calls.audit_logs?.[0] ?? [];
    expect(c.some(([m]) => m === 'eq' || m === 'gte' || m === 'lt')).toBe(false);
  });

  it('aktor po nazwie bez dopasowań → pusta lista bez odczytu audit_logs', async () => {
    const calls = mockClient({ profiles: [() => ({ data: [], error: null })] });
    await expect(listAuditLogs({ actor: 'Nikt' })).resolves.toEqual({
      status: 'ok',
      rows: [],
      nextCursor: null,
    });
    expect(calls.audit_logs).toBeUndefined();
  });
});

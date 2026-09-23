import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ADMIN_MAX_ROWS,
  getAdminStats,
  listCompanies,
  listReports,
  listUsers,
} from '@/lib/data/admin';
import { isSupabaseConfigured } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';

vi.mock('@/lib/env', () => ({ isSupabaseConfigured: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));

type Result = { data?: unknown; error?: unknown; count?: number | null };

/** Zapytanie-łańcuch Supabase: każdy filtr zwraca siebie, `await` daje `result(calls)`. */
function query(result: (calls: Array<[string, unknown[]]>) => Result) {
  const calls: Array<[string, unknown[]]> = [];
  const q: Record<string, unknown> = {};
  for (const method of ['select', 'is', 'eq', 'in', 'order', 'limit']) {
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

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isSupabaseConfigured).mockReturnValue(true);
});

describe('panel admina — błąd odczytu nie udaje pustej listy (#311)', () => {
  it.each([
    ['listCompanies', () => listCompanies(), 'companies'],
    ['listReports', () => listReports(), 'reports'],
    ['listUsers', () => listUsers(), 'profiles'],
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
    await expect(listUsers()).resolves.toEqual({ status: 'ok', rows: [], truncated: false });
  });

  it('lista dłuższa niż limit jest oznaczona jako obcięta', async () => {
    const rows = Array.from({ length: ADMIN_MAX_ROWS + 1 }, (_, i) => ({ id: `u${i}`, role: 'candidate' }));
    mockClient({ profiles: [() => ({ data: rows, error: null })] });
    const result = await listUsers();
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.rows).toHaveLength(ADMIN_MAX_ROWS);
    expect(result.truncated).toBe(true);
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
    const result = await listCompanies('awaiting');
    expect(calls.companies?.[0]).toContainEqual(['in', ['status', ['unverified', 'pending']]]);
    expect(result).toMatchObject({ status: 'ok', rows: [{ id: 'c1', vatNumber: 'BE1' }] });
  });
});

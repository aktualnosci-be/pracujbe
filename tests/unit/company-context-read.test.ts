import { describe, expect, it, vi } from 'vitest';
import { cookies } from 'next/headers';
import { getActiveCompany, getExpectedActiveCompany } from '@/lib/company-context';
import { createFakeDb } from '../helpers/fake-db';

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));

function tx(rows: unknown[]) {
  const db = createFakeDb().rows('company-context.memberships', rows);
  return { db, tx: db.txFor('user-1') };
}

describe('active company membership read', () => {
  it('confirms no membership only for an actual empty result', async () => {
    const { tx: t } = tx([]);
    expect((await getActiveCompany(t, 'user-1')).activeId).toBeNull();
  });

  it('rejects incomplete membership data', async () => {
    const { tx: t } = tx([{ role: 'member' }]);
    await expect(getActiveCompany(t, 'user-1')).rejects.toThrow();
  });

  it('propagates a database error instead of claiming no company', async () => {
    const db = createFakeDb().rows('company-context.memberships', () => { throw new Error('db down'); });
    await expect(getActiveCompany(db.txFor('user-1'), 'user-1')).rejects.toThrow('db down');
  });

  it('uses the cookie only when it matches an own active membership', async () => {
    const rows = [
      { company_id: 'c1', role: 'owner', name: 'A', status: 'verified' },
      { company_id: 'c2', role: 'recruiter', name: 'B', status: 'pending' },
    ];
    vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: 'c2' }) } as never);
    const { db, tx: t } = tx(rows);
    expect(await getActiveCompany(t, 'user-1')).toMatchObject({ activeId: 'c2', activeRole: 'recruiter', activeName: 'B' });
    expect(db.callsTo('company-context.memberships')[0]?.values).toEqual(['user-1']);
    vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: 'foreign' }) } as never);
    expect((await getActiveCompany(tx(rows).tx, 'user-1')).activeId).toBe('c1');
  });
});

describe('getExpectedActiveCompany (EMP-02 / CC25): firma widoku == firma zapisu', () => {
  const rows = [
    { company_id: 'c1', role: 'owner', name: 'A', status: 'verified' },
    { company_id: 'c2', role: 'recruiter', name: 'B', status: 'pending' },
  ];

  it('zwraca kontekst, gdy widok wyrenderowano dla bieżącej aktywnej firmy', async () => {
    vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: 'c2' }) } as never);
    expect(await getExpectedActiveCompany(tx(rows).tx, 'user-1', 'c2')).toMatchObject({
      ok: true,
      context: { activeId: 'c2', activeRole: 'recruiter' },
    });
  });

  it('KONTROLA UJEMNA: aktywna firma przełączona po wyrenderowaniu widoku → ACTIVE_COMPANY_CHANGED', async () => {
    // Widok dla A (c1), a w innej karcie przełączono na B (c2) — nie wolno pisać do B.
    vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: 'c2' }) } as never);
    expect(await getExpectedActiveCompany(tx(rows).tx, 'user-1', 'c1')).toEqual({
      ok: false,
      error: 'ACTIVE_COMPANY_CHANGED',
    });
  });

  it('KONTROLA UJEMNA: brak, pusta albo obca firma widoku nie przechodzi', async () => {
    vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: 'c1' }) } as never);
    for (const expected of [undefined, null, '', 'foreign', 42]) {
      expect(await getExpectedActiveCompany(tx(rows).tx, 'user-1', expected)).toEqual({
        ok: false,
        error: 'ACTIVE_COMPANY_CHANGED',
      });
    }
  });

  it('bez aktywnego członkostwa → NOT_FOUND', async () => {
    expect(await getExpectedActiveCompany(tx([]).tx, 'user-1', 'c1')).toEqual({ ok: false, error: 'NOT_FOUND' });
  });
});

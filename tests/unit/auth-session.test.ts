import { describe, expect, it, vi } from 'vitest';
import { readPortalIdentity } from '@/lib/auth/session';

const id = '11111111-1111-4111-8111-111111111111';
function fixture() {
  const getSession = vi.fn().mockResolvedValue({ user: { id, emailVerified: true, role: 'admin' }, session: { expiresAt: new Date(Date.now() + 60_000) } });
  const query = vi.fn().mockImplementation(async (sql: string) => ({ rows: sql.startsWith('SELECT id') ? [{ id, role: 'candidate' }] : [] }));
  const pool = { connect: vi.fn().mockResolvedValue({ query, release: vi.fn() }) };
  return { auth: { api: { getSession } }, pool, query, getSession };
}
describe('Tożsamość portalu', () => {
  it('bierze rolę z aktualnego profilu, a nie z danych sesji', async () => {
    const { auth, pool, query, getSession } = fixture();
    const headers = new Headers({ cookie: 'test-only' });
    expect(await readPortalIdentity(auth, pool, headers)).toEqual({ id, role: 'candidate' });
    expect(getSession).toHaveBeenCalledWith({ headers });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('is_active = true AND deleted_at IS NULL'), [id]);
  });
  it.each([null, { user: { id, emailVerified: false }, session: { expiresAt: new Date(Date.now() + 60_000) } },
    { user: { id, emailVerified: true }, session: { expiresAt: new Date(0) } }])('nie sięga do profilu bez aktywnej zweryfikowanej sesji', async session => {
    const { auth, pool, getSession } = fixture();
    getSession.mockResolvedValue(session);
    expect(await readPortalIdentity(auth, pool, new Headers())).toBeNull();
    expect(pool.connect).not.toHaveBeenCalled();
  });
  it('ponownie odczytuje profil i odbiera dostęp po jego dezaktywacji', async () => {
    const { auth, pool, query } = fixture();
    expect(await readPortalIdentity(auth, pool, new Headers())).not.toBeNull();
    query.mockResolvedValue({ rows: [] });
    expect(await readPortalIdentity(auth, pool, new Headers())).toBeNull();
    expect(pool.connect).toHaveBeenCalledTimes(2);
  });
  it('nie zamienia awarii bazy w pozorne anonimowe demo', async () => {
    const { auth, pool } = fixture();
    pool.connect.mockRejectedValue(new Error('database unavailable'));
    await expect(readPortalIdentity(auth, pool, new Headers())).rejects.toThrow('database unavailable');
  });
});

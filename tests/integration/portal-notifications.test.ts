import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { actAs, realSession } from './support/real-portal';
import { startPortalDb } from './support/portal-db';

vi.mock('@/lib/db/portal', async () => (await import('./support/real-portal')).realPortal());
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

const { getNotifications, getNotificationsPage } = await import('../../src/lib/data/notifications');
const { markNotificationsRead, loadMoreNotifications } = await import('../../src/lib/actions/notifications');

// #25: powiadomienia pod RLS na PostgreSQL 16 — lista, licznik i RPC oznaczania.
let alice: string;
let bob: string;

beforeAll(async () => {
  const db = await startPortalDb();
  realSession.db = db;
  alice = await db.createUser('candidate');
  bob = await db.createUser('employer');
  await db.admin.query(`INSERT INTO public.notifications(profile_id, type, entity_type, created_at, read_at)
    SELECT $1, 'system', 'job', now() - (g || ' minutes')::interval, CASE WHEN g > 22 THEN now() END
      FROM generate_series(1, 25) g`, [alice]);
  await db.admin.query(`INSERT INTO public.notifications(profile_id, type, entity_type) VALUES ($1, 'message_received', 'conversation')`, [bob]);
});

afterAll(async () => { await realSession.db?.stop(); });

describe('powiadomienia na PostgreSQL (#25)', () => {
  it('lista = 20 najnowszych własnych, licznik liczy wszystkie nieprzeczytane (nie z listy)', async () => {
    actAs({ id: alice, role: 'candidate' });
    const result = await getNotifications('pl');
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.items).toHaveLength(20);
    expect(result.unread).toBe(22);
  });

  it('inny użytkownik widzi wyłącznie swoje powiadomienie', async () => {
    actAs({ id: bob, role: 'employer' });
    const result = await getNotifications('pl');
    expect(result).toMatchObject({ status: 'ready', unread: 1 });
    if (result.status === 'ready') expect(result.items.map((i) => i.href)).toEqual(['/employer/wiadomosci']);
  });

  it('pełna lista (#148): kursor przechodzi przez wszystkie 25 bez duplikatów, także przy równym created_at', async () => {
    actAs({ id: alice, role: 'candidate' });
    // Wszystkie pozycje o identycznym czasie (także na granicy stron) — kursor (created_at, id)
    // je rozróżnia; sam `created_at <` zgubiłby drugą stronę.
    await realSession.db!.admin.query(`UPDATE public.notifications SET created_at = '2026-01-01T00:00:00.123456Z'
      WHERE profile_id = $1`, [alice]);
    const first = await getNotificationsPage('pl');
    if (first.status !== 'ready') throw new Error('first page');
    expect(first.page.items).toHaveLength(20);
    expect(first.page.unread).toBe(22);
    expect(first.page.nextCursor).not.toBeNull();
    const second = await loadMoreNotifications('pl', first.page.nextCursor, false);
    if (second.status !== 'ready') throw new Error('second page');
    expect(second.page.nextCursor).toBeNull();
    const ids = [...first.page.items, ...second.page.items].map((i) => i.id);
    expect(ids).toHaveLength(25);
    expect(new Set(ids).size).toBe(25);
  });

  it('pełna lista (#148): filtr nieprzeczytanych i RLS — obcy kursor nie odsłania cudzych', async () => {
    actAs({ id: alice, role: 'candidate' });
    const unread = await getNotificationsPage('pl', { unreadOnly: true });
    if (unread.status !== 'ready') throw new Error('unread');
    expect(unread.page.items.every((i) => i.unread)).toBe(true);
    const rest = await loadMoreNotifications('pl', unread.page.nextCursor, true);
    if (rest.status !== 'ready') throw new Error('rest');
    expect(unread.page.items.length + rest.page.items.length).toBe(22);

    actAs({ id: bob, role: 'employer' });
    const bobs = await loadMoreNotifications('pl', { createdAt: '2999-01-01T00:00:00Z', id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }, false);
    expect(bobs.status === 'ready' && bobs.page.items.map((i) => i.href)).toEqual(['/employer/wiadomosci']);
  });

  it('mark_notifications_read oznacza tylko własne; cudze ID nie zmienia cudzego stanu', async () => {
    actAs({ id: bob, role: 'employer' });
    const aliceIds = (await realSession.db!.admin.query('SELECT id FROM public.notifications WHERE profile_id=$1 AND read_at IS NULL', [alice])).rows.map((r) => r.id);
    expect(await markNotificationsRead(aliceIds)).toEqual({ ok: true, count: 0 });
    expect(await markNotificationsRead()).toEqual({ ok: true, count: 1 });
    actAs({ id: alice, role: 'candidate' });
    const after = await getNotifications('pl');
    expect(after).toMatchObject({ status: 'ready', unread: 22 });
  });

  it('gość nie oznacza niczego', async () => {
    actAs(null);
    expect(await markNotificationsRead()).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
  });
});

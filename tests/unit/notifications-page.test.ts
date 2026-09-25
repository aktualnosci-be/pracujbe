import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getTranslations } from 'next-intl/server';

import type { PortalIdentity } from '@/lib/auth/session';
import { getNotificationsPage, NOTIFICATION_PAGE_SIZE, parseUnreadFilter } from '@/lib/data/notifications';
import { loadMoreNotifications } from '@/lib/actions/notifications';
import { captureError } from '@/lib/error-report';
import { fakeDb, fakeSession, pgError, resetFakeDb } from '../helpers/fake-db';

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn().mockResolvedValue((key: string) => key),
}));
vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

const SELF = '11111111-1111-4111-8111-111111111111';
const CONV = '2f1c1b8e-8c1a-4a4c-9d7e-3a1f0c2b9e11';

function row(i: number, readAt: string | null = null) {
  return {
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    type: 'message_received',
    entity_type: 'conversation',
    entity_id: CONV,
    data: {},
    read_at: readAt,
    created_at: '2026-09-20T09:00:00.123456+00:00',
  };
}

function db(rows: unknown[] | (() => unknown[]), unread = 0) {
  resetFakeDb({ id: SELF, role: 'candidate' } as PortalIdentity);
  fakeDb.rows('notifications.page', typeof rows === 'function' ? rows : () => rows).count('notifications.unread', () => unread);
  return fakeDb;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getTranslations).mockResolvedValue(((key: string) => key) as never);
});

describe('getNotificationsPage (#148)', () => {
  it('zwraca stronę 20 pozycji i kursor ostatniej, gdy baza ma więcej (LIMIT 21)', async () => {
    db(Array.from({ length: NOTIFICATION_PAGE_SIZE + 1 }, (_, i) => row(30 - i)), 25);
    const result = await getNotificationsPage('pl');
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.page.items).toHaveLength(NOTIFICATION_PAGE_SIZE);
    expect(result.page.unread).toBe(25);
    const last = result.page.items[NOTIFICATION_PAGE_SIZE - 1]!;
    expect(result.page.nextCursor).toEqual({ createdAt: last.createdAt, id: last.id });
    // Ten sam cel co dropdown (resolveHref): rozmowa → ?c=, data w Europe/Brussels.
    expect(last.href).toBe(`/candidate/wiadomosci?c=${CONV}`);
    expect(last.dateLabel).not.toBe('');
    const call = fakeDb.callsTo('notifications.page')[0]!;
    expect(call.values).toEqual([SELF, false, null, null, NOTIFICATION_PAGE_SIZE + 1]);
    expect(call.text).toContain('(created_at, id) <');
    expect(call.text).toContain('ORDER BY created_at DESC, id DESC');
  });

  it('dokładnie 20 pozycji = koniec listy (bez kursora)', async () => {
    db(Array.from({ length: NOTIFICATION_PAGE_SIZE }, (_, i) => row(i + 1)));
    const result = await getNotificationsPage('pl');
    expect(result.status === 'ready' && result.page.nextCursor).toBeNull();
  });

  it('przekazuje filtr nieprzeczytanych i kursor jako parametry zapytania', async () => {
    db([row(1)], 1);
    const cursor = { createdAt: '2026-09-20T09:00:00.123456+00:00', id: row(9).id };
    await getNotificationsPage('pl', { unreadOnly: true, cursor });
    const call = fakeDb.callsTo('notifications.page')[0]!;
    expect(call.values).toEqual([SELF, true, cursor.createdAt, cursor.id, NOTIFICATION_PAGE_SIZE + 1]);
    expect(call.text).toContain('read_at IS NULL');
  });

  it('błąd bazy → stan błędu bez danych, raport do kanału błędów', async () => {
    const error = pgError('XX000', 'private detail');
    db(() => { throw error; });
    expect(await getNotificationsPage('pl')).toEqual({ status: 'error' });
    expect(captureError).toHaveBeenCalledWith(error, { area: 'notifications.getNotificationsPage' });
  });

  it('bez sesji: pusta lista, bez zapytań; admin: błąd bez zapytań', async () => {
    db([row(1)]);
    fakeSession.identity = null;
    expect(await getNotificationsPage('pl')).toEqual({ status: 'ready', page: { items: [], nextCursor: null, unread: 0 } });
    fakeSession.identity = { id: SELF, role: 'admin' } as PortalIdentity;
    expect(await getNotificationsPage('pl')).toEqual({ status: 'error' });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('demo: pozycje dla roli panelu, filtr nieprzeczytanych działa, bez kolejnych stron', async () => {
    db([]);
    fakeSession.configured = false;
    const all = await getNotificationsPage('pl', { demoRole: 'employer' });
    const unread = await getNotificationsPage('pl', { demoRole: 'employer', unreadOnly: true });
    if (all.status !== 'ready' || unread.status !== 'ready') throw new Error('demo');
    expect(all.page.items).toHaveLength(3);
    expect(all.page.items[0]?.href).toBe('/employer/oferty');
    expect(unread.page.items.every((item) => item.unread)).toBe(true);
    expect(unread.page.items).toHaveLength(all.page.unread);
    expect(all.page.nextCursor).toBeNull();
    expect(fakeDb.calls).toHaveLength(0);
  });
});

describe('loadMoreNotifications — walidacja wejścia (#148)', () => {
  const cursor = { createdAt: '2026-09-20T09:00:00.123456+00:00', id: row(3).id };

  it('poprawny kursor → kolejna strona pod sesją', async () => {
    db([row(2)], 0);
    const result = await loadMoreNotifications('pl', cursor, true);
    expect(result.status).toBe('ready');
    expect(fakeDb.callsTo('notifications.page')[0]!.values.slice(0, 4)).toEqual([SELF, true, cursor.createdAt, cursor.id]);
  });

  it.each([
    ['nieobsługiwany język', 'de', cursor, false],
    ['id nie-UUID', 'pl', { ...cursor, id: "x' OR 1=1" }, false],
    ['zła data', 'pl', { ...cursor, createdAt: 'wczoraj' }, false],
    ['brak kursora', 'pl', null, false],
    ['filtr nie-boolean', 'pl', cursor, 'true'],
  ])('odrzuca: %s — bez zapytania', async (_label, locale, badCursor, unreadOnly) => {
    db([row(1)]);
    expect(await loadMoreNotifications(locale as string, badCursor, unreadOnly)).toEqual({ status: 'error' });
    expect(fakeDb.calls).toHaveLength(0);
  });
});

describe('parseUnreadFilter', () => {
  it.each([
    ['1', true],
    [undefined, false],
    ['0', false],
    ['true', false],
    [['1', '1'], false],
  ] as const)('%j → %s', (value, expected) => {
    expect(parseUnreadFilter(value as string | string[] | undefined)).toBe(expected);
  });
});

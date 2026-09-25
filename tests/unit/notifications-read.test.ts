import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getTranslations } from 'next-intl/server';

import type { PortalIdentity } from '@/lib/auth/session';
import { getNotifications } from '@/lib/data/notifications';
import { captureError } from '@/lib/sentry';
import { fakeDb, fakeSession, pgError, resetFakeDb } from '../helpers/fake-db';

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn().mockResolvedValue((key: string) => key),
}));
vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));

const SELF = '11111111-1111-4111-8111-111111111111';

function db(options: { rows?: unknown[]; count?: number; listError?: unknown; countError?: unknown } = {}) {
  resetFakeDb({ id: SELF, role: 'candidate' } as PortalIdentity);
  fakeDb
    .rows('notifications.latest', () => {
      if (options.listError) throw options.listError;
      return options.rows ?? [];
    })
    .count('notifications.unread', () => {
      if (options.countError) throw options.countError;
      return options.count ?? 0;
    });
  return fakeDb;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getTranslations).mockResolvedValue(((key: string) => key) as never);
});

describe('notifications read', () => {
  it('keeps a truly empty inbox as a ready result', async () => {
    db();
    expect(await getNotifications('pl')).toEqual({ status: 'ready', items: [], unread: 0 });
    expect(captureError).not.toHaveBeenCalled();
  });

  it.each(['listError', 'countError'] as const)(
    'reports %s without exposing data or claiming zero unread', async (field) => {
      const error = pgError('XX000', 'private database detail');
      db({ [field]: error });
      expect(await getNotifications('pl')).toEqual({ status: 'error' });
      expect(captureError).toHaveBeenCalledWith(error, { area: 'notifications.getNotifications' });
    },
  );

  it('reports an admin session (no notification panel role) as an error', async () => {
    db();
    fakeSession.identity = { id: SELF, role: 'admin' };
    expect(await getNotifications('en')).toEqual({ status: 'error' });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('keeps missing session safe and does not query another account', async () => {
    db();
    fakeSession.identity = null;
    expect(await getNotifications('pl')).toEqual({ status: 'ready', items: [], unread: 0 });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('falls back to demo notifications without backend configuration', async () => {
    db();
    fakeSession.configured = false;
    const result = await getNotifications('pl', 'employer');
    expect(result.status).toBe('ready');
    if (result.status === 'ready') expect(result.items[0]?.href).toBe('/employer/oferty');
    expect(fakeDb.calls).toHaveLength(0);
  });

  it.each([
    { role: 'candidate', href: '/candidate/wiadomosci' },
    { role: 'employer', href: '/employer/wiadomosci' },
  ] as const)('uses the verified $role role for a notification link', async ({ role, href }) => {
    db({ count: 1, rows: [{ id: 'n1', type: 'message_received', entity_type: 'conversation', read_at: null, created_at: '2026-09-23T00:00:00Z' }] });
    fakeSession.identity = { id: SELF, role };
    const result = await getNotifications('nl');
    expect(result.status).toBe('ready');
    if (result.status === 'ready') {
      expect(result.unread).toBe(1);
      expect(result.items[0]?.href).toBe(href);
    }
    // Obie kwerendy są zawężone do właściciela sesji, w jego transakcji.
    for (const name of ['notifications.latest', 'notifications.unread']) {
      const [call] = fakeDb.callsTo(name);
      expect(call?.values).toEqual([SELF]);
      expect(call?.as).toBe(SELF);
    }
  });
});

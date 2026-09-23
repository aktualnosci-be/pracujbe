import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getTranslations } from 'next-intl/server';

import { getNotifications } from '@/lib/data/notifications';
import { isSupabaseConfigured } from '@/lib/env';
import { createServerClient } from '@/lib/supabase/server';
import { captureError } from '@/lib/sentry';

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn().mockResolvedValue((key: string) => key),
}));
vi.mock('@/lib/env', () => ({ isSupabaseConfigured: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }));
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));

function client(options: {
  role?: string | null;
  profileError?: unknown;
  listError?: unknown;
  countError?: unknown;
  count?: number | null;
  rows?: unknown[] | null;
  user?: { id: string } | null;
  authError?: unknown;
} = {}) {
  const profile = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: options.role === null ? null : { role: options.role ?? 'candidate' },
      error: options.profileError ?? null,
    }),
  };
  const list = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: options.rows === undefined ? [] : options.rows, error: options.listError ?? null }),
  };
  const counter = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockResolvedValue({ count: options.count === undefined ? 0 : options.count, error: options.countError ?? null }),
  };
  const supabase = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: options.user === undefined ? { id: 'self' } : options.user }, error: options.authError ?? null }) },
    from: vi.fn(),
  };
  let notificationsCalls = 0;
  supabase.from.mockImplementation((table: string) => {
    if (table === 'profiles') return profile;
    return notificationsCalls++ === 0 ? list : counter;
  });
  vi.mocked(createServerClient).mockResolvedValue(supabase as never);
  return { supabase, profile, list, counter };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getTranslations).mockResolvedValue(((key: string) => key) as never);
  vi.mocked(isSupabaseConfigured).mockReturnValue(true);
});

describe('notifications read', () => {
  it('keeps a truly empty inbox as a ready result', async () => {
    client();
    expect(await getNotifications('pl')).toEqual({ status: 'ready', items: [], unread: 0 });
    expect(captureError).not.toHaveBeenCalled();
  });

  it.each(['profileError', 'listError', 'countError', 'authError'] as const)(
    'reports %s without exposing data or claiming zero unread', async (field) => {
      const error = { message: 'private database detail' };
      client({ [field]: error });
      expect(await getNotifications('pl')).toEqual({ status: 'error' });
      expect(captureError).toHaveBeenCalledWith(error, { area: 'notifications.getNotifications' });
    },
  );

  it.each([{ role: null }, { role: 'unknown' }, { count: null }, { rows: null }])(
    'reports an incomplete result: %j', async (options) => {
      client(options);
      expect(await getNotifications('en')).toEqual({ status: 'error' });
    },
  );

  it('keeps missing session safe and does not query another account', async () => {
    const { supabase } = client({ user: null });
    expect(await getNotifications('pl')).toEqual({ status: 'ready', items: [], unread: 0 });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it.each([
    { role: 'candidate', href: '/candidate/wiadomosci' },
    { role: 'employer', href: '/employer/wiadomosci' },
  ])('uses the verified $role role for a notification link', async ({ role, href }) => {
    const { list, counter } = client({ role, count: 1, rows: [{ id: 'n1', type: 'message_received', entity_type: 'conversation', read_at: null, created_at: '2026-09-23T00:00:00Z' }] });
    const result = await getNotifications('nl');
    expect(result.status).toBe('ready');
    if (result.status === 'ready') {
      expect(result.unread).toBe(1);
      expect(result.items[0]?.href).toBe(href);
    }
    expect(list.eq).toHaveBeenCalledWith('profile_id', 'self');
    expect(counter.eq).toHaveBeenCalledWith('profile_id', 'self');
  });
});

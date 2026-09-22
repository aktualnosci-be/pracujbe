import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getLatestActiveOffer } from '@/lib/data/candidate';
import { isSupabaseConfigured } from '@/lib/env';
import { captureError } from '@/lib/sentry';
import { createServerClient } from '@/lib/supabase/server';

vi.mock('@/lib/env', () => ({ isSupabaseConfigured: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }));
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isSupabaseConfigured).mockReturnValue(true);
});

describe('getLatestActiveOffer', () => {
  it('filters active and unexpired rows before a deterministic limit 1', async () => {
    const calls: string[] = [];
    const query = {
      select: vi.fn(() => (calls.push('select'), query)),
      eq: vi.fn(() => (calls.push('eq'), query)),
      is: vi.fn(() => (calls.push('is'), query)),
      in: vi.fn(() => (calls.push('in'), query)),
      not: vi.fn(() => (calls.push('not'), query)),
      or: vi.fn(() => (calls.push('or'), query)),
      order: vi.fn(() => (calls.push('order'), query)),
      limit: vi.fn(() => (calls.push('limit'), query)),
      maybeSingle: vi.fn(async () => {
        calls.push('maybeSingle');
        return { data: null, error: null as unknown };
      }),
    };
    const supabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: '22222222-2222-4222-8222-222222222222' } },
        }),
      },
      from: vi.fn().mockReturnValue(query),
    };
    vi.mocked(createServerClient).mockResolvedValue(supabase as never);

    await expect(getLatestActiveOffer('pl')).resolves.toBeNull();

    expect(supabase.from).toHaveBeenCalledWith('offers');
    expect(query.in).toHaveBeenCalledWith('status', ['sent', 'viewed']);
    expect(query.not).toHaveBeenCalledWith('sent_at', 'is', null);
    expect(query.or).toHaveBeenCalledWith(
      expect.stringMatching(/^expires_at\.is\.null,expires_at\.gt\.\d{4}-/),
    );
    expect(query.order.mock.calls).toEqual([
      ['sent_at', { ascending: false }],
      ['id', { ascending: false }],
    ]);
    expect(query.limit).toHaveBeenCalledWith(1);
    expect(calls.indexOf('in')).toBeLessThan(calls.indexOf('limit'));
    expect(calls.indexOf('or')).toBeLessThan(calls.indexOf('limit'));

    query.maybeSingle.mockResolvedValueOnce({ data: null, error: { code: 'read-failed' } });
    await expect(getLatestActiveOffer('pl')).resolves.toBeNull();
    expect(captureError).toHaveBeenCalledWith(
      { code: 'read-failed' },
      { area: 'candidate.getLatestActiveOffer' },
    );
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { recordConsent } from '@/lib/actions/consent';
import { isSupabaseConfigured } from '@/lib/env';
import { checkRateLimit } from '@/lib/rate-limit';
import { createServerClient } from '@/lib/supabase/server';

/**
 * #349 — dowód zgody (RODO art. 7): `recordConsent` przekazuje do RPC `record_consent`
 * kategorie, znormalizowane źródło, visitor_id, IP klienta i user-agent. Każdy błąd kończy się
 * `{ ok: false }` bez wyjątku do UI (Invariant #8).
 */

const rpc = vi.fn();

vi.mock('@/lib/env', () => ({ isSupabaseConfigured: vi.fn(() => true) }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(async () => true) }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn(async () => ({ rpc })) }));
vi.mock('next/headers', () => ({
  headers: async () =>
    new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1', 'user-agent': 'Mozilla/5.0 test' }),
  cookies: async () => ({
    get: (name: string) => (name === 'pracujbe_visitor' ? { value: 'visitor-1' } : undefined),
  }),
}));

const CATEGORIES = { necessary: true, preferences: false, analytics: true, marketing: false };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isSupabaseConfigured).mockReturnValue(true);
  vi.mocked(checkRateLimit).mockResolvedValue(true);
  rpc.mockResolvedValue({ error: null });
});

describe('recordConsent', () => {
  it('wysyła kategorie, źródło, visitor_id, IP klienta i user-agent', async () => {
    expect(await recordConsent(CATEGORIES, 'cookie_settings')).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith('record_consent', {
      p_categories: CATEGORIES,
      p_source: 'cookie_settings',
      p_visitor_id: 'visitor-1',
      p_ip: '203.0.113.7',
      p_user_agent: 'Mozilla/5.0 test',
    });
  });

  it('nieznane źródło → cookie_banner (nie zapisujemy dowolnego tekstu klienta)', async () => {
    await recordConsent(CATEGORIES, '<script>');
    expect(rpc.mock.calls[0]![1].p_source).toBe('cookie_banner');
  });

  it('błąd RPC → ok:false', async () => {
    rpc.mockResolvedValue({ error: { message: 'permission denied for function record_consent' } });
    expect(await recordConsent(CATEGORIES, 'cookie_banner')).toEqual({ ok: false });
  });

  it('wyjątek klienta danych → ok:false bez rzucania do UI', async () => {
    vi.mocked(createServerClient).mockRejectedValueOnce(new Error('ECONNREFUSED 10.0.0.1:5432'));
    await expect(recordConsent(CATEGORIES, 'cookie_banner')).resolves.toEqual({ ok: false });
  });

  it('limit przekroczony albo tryb demo → ok:false bez RPC', async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce(false);
    expect(await recordConsent(CATEGORIES, 'footer')).toEqual({ ok: false });
    vi.mocked(isSupabaseConfigured).mockReturnValueOnce(false);
    expect(await recordConsent(CATEGORIES, 'footer')).toEqual({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });
});

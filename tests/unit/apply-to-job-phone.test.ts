import { beforeEach, describe, expect, it, vi } from 'vitest';

import { applyToJob } from '@/lib/actions/applications';
import { isSupabaseConfigured } from '@/lib/env';

/**
 * #145 — przepływ aplikowania: niepoprawny numer nie dociera do RPC, poprawny trafia do
 * zapisu w E.164, a tryb demo zwraca rozróżnialny kod zamiast ogólnego błędu walidacji.
 */

const rpc = vi.fn();

vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(async () => true) }));
vi.mock('@/lib/env', () => ({ isSupabaseConfigured: vi.fn(() => true) }));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(async () => ({ rpc })),
}));

const input = {
  jobId: '11111111-1111-4111-8111-111111111111',
  agreeTerms: true as const,
  idempotencyKey: '22222222-2222-4222-8222-222222222222',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isSupabaseConfigured).mockReturnValue(true);
  rpc.mockResolvedValue({ data: 'application-1', error: null });
});

describe('applyToJob — phone', () => {
  it.each(['------', '+48 abc', '1', '+999 123 456 789'])(
    'returns a phone field error for %s without calling the RPC',
    async (phone) => {
      expect(await applyToJob({ ...input, phone, phoneCountry: 'PL' })).toEqual({
        ok: false,
        error: 'VALIDATION_FAILED',
        field: 'phone',
      });
      expect(rpc).not.toHaveBeenCalled();
    },
  );

  it('saves the canonical E.164 number and does not prepend a second prefix', async () => {
    expect(await applyToJob({ ...input, phone: '+32 470 12 34 56', phoneCountry: 'PL' })).toEqual({
      ok: true,
      id: 'application-1',
    });
    expect(rpc).toHaveBeenCalledWith(
      'apply_to_job',
      expect.objectContaining({ p_phone: '+32470123456' }),
    );
  });

  it('reports the demo mode instead of a validation failure for demo job ids', async () => {
    vi.mocked(isSupabaseConfigured).mockReturnValue(false);
    expect(
      await applyToJob({ ...input, jobId: '1002', phone: '470 12 34 56', phoneCountry: 'BE' }),
    ).toEqual({ ok: false, error: 'DEMO_UNAVAILABLE' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('still flags an invalid phone on the field in demo mode', async () => {
    vi.mocked(isSupabaseConfigured).mockReturnValue(false);
    expect(await applyToJob({ ...input, jobId: '1002', phone: 'abc', phoneCountry: 'PL' })).toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
      field: 'phone',
    });
  });
});

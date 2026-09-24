import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getJobCompanyBlockAction, setCompanyBlockAction } from '@/lib/actions/company-blocks';
import { getJobCompanyBlock, loadMyCompanyBlocks } from '@/lib/data/company-blocks';
import { isSupabaseConfigured } from '@/lib/env';
import { captureError } from '@/lib/sentry';
import { createServerClient } from '@/lib/supabase/server';

vi.mock('@/lib/env', () => ({ isSupabaseConfigured: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }));
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));

const COMPANY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const JOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function supabaseWith(rpc: (name: string, args?: unknown) => { data: unknown; error: unknown }, user: object | null = { id: 'c1' }) {
  const client = {
    auth: { getUser: vi.fn(async () => ({ data: { user } })) },
    rpc: vi.fn(async (name: string, args?: unknown) => rpc(name, args)),
  };
  vi.mocked(createServerClient).mockResolvedValue(client as never);
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isSupabaseConfigured).mockReturnValue(true);
});

describe('setCompanyBlockAction (#97)', () => {
  it('blokuje i odblokowuje przez RPC pod sesją', async () => {
    const client = supabaseWith((_name, args) => ({ data: (args as { p_blocked: boolean }).p_blocked, error: null }));
    expect(await setCompanyBlockAction(COMPANY, true)).toEqual({ ok: true, blocked: true });
    expect(await setCompanyBlockAction(COMPANY, false)).toEqual({ ok: true, blocked: false });
    expect(client.rpc).toHaveBeenCalledWith('set_company_block', { p_company_id: COMPANY, p_blocked: true });
  });

  it.each([
    ['nie-UUID', 'c1', true],
    ['wstrzyknięcie', `${COMPANY}' or '1'='1`, true],
    ['brak flagi', COMPANY, 'yes'],
  ])('odrzuca %s, zanim zapyta bazę', async (_reason, companyId, blocked) => {
    const client = supabaseWith(() => ({ data: true, error: null }));
    expect(await setCompanyBlockAction(companyId, blocked)).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('mapuje odmowę bazy na kod bez technikaliów', async () => {
    supabaseWith(() => ({ data: null, error: { message: 'PERMISSION_DENIED: blokada firm tylko dla kandydata' } }));
    expect(await setCompanyBlockAction(COMPANY, true)).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    supabaseWith(() => ({ data: null, error: { message: 'relation "x" does not exist' } }));
    expect(await setCompanyBlockAction(COMPANY, true)).toEqual({ ok: false, error: 'INTERNAL' });
  });

  it('tryb demo: waliduje identyfikator firmy demo i nie zapisuje', async () => {
    vi.mocked(isSupabaseConfigured).mockReturnValue(false);
    expect(await setCompanyBlockAction('c11', false)).toEqual({ ok: true, blocked: false, demo: true });
    expect(await setCompanyBlockAction('drop table', false)).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(createServerClient).not.toHaveBeenCalled();
  });
});

describe('odczyt blokad', () => {
  it('lista własnych blokad z nazwą firmy; błąd ≠ pusta lista', async () => {
    supabaseWith(() => ({
      data: [{ company_id: COMPANY, company_name: 'Firma', blocked_at: '2026-09-20T10:00:00Z' }],
      error: null,
    }));
    expect(await loadMyCompanyBlocks()).toEqual({
      status: 'ready',
      demo: false,
      blocks: [{ companyId: COMPANY, companyName: 'Firma', blockedAt: '2026-09-20T10:00:00Z' }],
    });

    const readError = { message: 'boom' };
    supabaseWith(() => ({ data: null, error: readError }));
    expect(await loadMyCompanyBlocks()).toEqual({ status: 'error' });
    expect(captureError).toHaveBeenCalledWith(readError, { area: 'company-blocks.loadMyCompanyBlocks' });
  });

  it('stan na szczególe oferty: gość i brak wiersza → none, kandydat → stan', async () => {
    supabaseWith(() => ({ data: [], error: null }), null);
    expect(await getJobCompanyBlock(JOB)).toEqual({ status: 'none' });

    supabaseWith(() => ({ data: [], error: null }));
    expect(await getJobCompanyBlock(JOB)).toEqual({ status: 'none' });

    const client = supabaseWith(() => ({
      data: [{ company_id: COMPANY, company_name: 'Firma', blocked: true }],
      error: null,
    }));
    expect(await getJobCompanyBlock(JOB)).toEqual({
      status: 'ready', companyId: COMPANY, companyName: 'Firma', blocked: true,
    });
    expect(client.rpc).toHaveBeenCalledWith('get_job_company_block', { p_job_id: JOB });
  });

  it('akcja szczegółu oferty odrzuca nie-UUID bez zapytania', async () => {
    const client = supabaseWith(() => ({ data: [], error: null }));
    expect(await getJobCompanyBlockAction('../etc')).toEqual({ status: 'none' });
    expect(client.rpc).not.toHaveBeenCalled();
  });
});

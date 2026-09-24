import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deleteMyAccountAction } from '@/lib/actions/account-data';
import { POST as exportData } from '@/app/api/account/export/route';
import { isSupabaseConfigured } from '@/lib/env';
import { captureError } from '@/lib/sentry';
import { createServerClient } from '@/lib/supabase/server';

/**
 * #486 — usunięcie konta i eksport danych kandydata: potwierdzenie adresem konta (porównanie
 * w bazie), mapowanie błędów bez technikaliów, eksport tylko z tej samej witryny, `no-store`.
 */

vi.mock('@/lib/env', () => ({
  isSupabaseConfigured: vi.fn(),
  env: { siteUrl: 'https://pracuj.be' },
}));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }));
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));

const rpc = vi.fn();
const signOut = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isSupabaseConfigured).mockReturnValue(true);
  signOut.mockResolvedValue({ error: null });
  vi.mocked(createServerClient).mockResolvedValue({ rpc, auth: { signOut } } as never);
});

describe('deleteMyAccountAction', () => {
  it('niepoprawny adres → mismatch bez wywołania bazy', async () => {
    expect(await deleteMyAccountAction('nie-adres')).toEqual({ ok: false, error: 'mismatch' });
    expect(await deleteMyAccountAction(undefined)).toEqual({ ok: false, error: 'mismatch' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('tryb demo: walidacja bez zapisu', async () => {
    vi.mocked(isSupabaseConfigured).mockReturnValue(false);
    expect(await deleteMyAccountAction('ja@test.be')).toEqual({ ok: true, demo: true });
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it('wysyła przycięty adres do RPC i zamyka sesję po sukcesie', async () => {
    rpc.mockResolvedValue({ data: { erased: true }, error: null });
    expect(await deleteMyAccountAction('  Ja@Test.be ')).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith('request_account_erasure', { p_confirm_email: 'Ja@Test.be' });
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['VALIDATION_FAILED: CONFIRMATION_MISMATCH', 'mismatch', false],
    ['PERMISSION_DENIED', 'denied', false],
    ['UNAUTHENTICATED', 'denied', false],
    ['deadlock detected', 'failed', true],
  ])('błąd RPC %s → %s', async (message, error, reported) => {
    rpc.mockResolvedValue({ data: null, error: { message } });
    expect(await deleteMyAccountAction('ja@test.be')).toEqual({ ok: false, error });
    expect(signOut).not.toHaveBeenCalled();
    expect(vi.mocked(captureError).mock.calls.length > 0).toBe(reported);
  });
});

function exportRequest(origin: string | null): Request {
  return new Request('https://pracuj.be/api/account/export', {
    method: 'POST',
    headers: origin ? { origin } : {},
  });
}

describe('POST /api/account/export', () => {
  it('bez Origin albo z obcej witryny → 403 bez odczytu danych', async () => {
    for (const origin of [null, 'https://evil.example']) {
      const res = await exportData(exportRequest(origin));
      expect(res.status).toBe(403);
      expect(res.headers.get('cache-control')).toBe('private, no-store');
    }
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it('tryb demo: plik z oznaczeniem demo', async () => {
    vi.mocked(isSupabaseConfigured).mockReturnValue(false);
    const res = await exportData(exportRequest('https://pracuj.be'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="pracujbe-dane-\d{4}-\d{2}-\d{2}\.json"$/);
    expect(await res.json()).toMatchObject({ format: 'pracujbe-export/1', demo: true });
  });

  it('zwraca dane z RPC jako załącznik no-store', async () => {
    rpc.mockResolvedValue({ data: { format: 'pracujbe-export/1', profile: { first_name: 'Ala' } }, error: null });
    const res = await exportData(exportRequest('https://pracuj.be'));
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('export_my_data');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({ format: 'pracujbe-export/1', profile: { first_name: 'Ala' } });
  });

  it.each([
    ['RATE_LIMITED', 429, 'rate_limited'],
    ['PERMISSION_DENIED', 401, 'unauthorized'],
    ['connection terminated: host db.internal', 503, 'unavailable'],
  ])('błąd %s → %i bez szczegółów', async (message, status, error) => {
    rpc.mockResolvedValue({ data: null, error: { message } });
    const res = await exportData(exportRequest('https://pracuj.be'));
    expect(res.status).toBe(status);
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({ error });
    expect(body).not.toContain('db.internal');
  });
});

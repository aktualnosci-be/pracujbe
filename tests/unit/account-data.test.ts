import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deleteMyAccountAction } from '@/lib/actions/account-data';
import { POST as exportData } from '@/app/api/account/export/route';
import { captureError } from '@/lib/error-report';
import { fakeDb, fakeSession, pgError, resetFakeDb } from '../helpers/fake-db';

/**
 * #486 — usunięcie konta i eksport danych kandydata: potwierdzenie adresem konta (porównanie
 * w bazie), mapowanie błędów bez technikaliów, eksport tylko z tej samej witryny, `no-store`.
 */

vi.mock('@/lib/env', () => ({ env: { siteUrl: 'https://pracuj.be' } }));
vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

const SELF = '11111111-1111-4111-8111-111111111111';
/** Wywołania RPC (nazwa + argumenty po nazwach) z atrapy transakcji (#25). */
const rpc = vi.fn();
/** Wynik RPC: wartość albo komunikat błędu bazy. */
let outcome: { data?: unknown; error?: string } = {};

function register(fn: string) {
  fakeDb.rpc(fn, ({ args }: { args: Record<string, unknown> }) => {
    if (Object.keys(args).length) rpc(fn, args);
    else rpc(fn);
    if (outcome.error) throw pgError('P0001', outcome.error);
    return outcome.data ?? null;
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  outcome = {};
  resetFakeDb({ id: SELF, role: 'candidate' });
  register('request_account_erasure');
  register('export_my_data');
});

describe('deleteMyAccountAction', () => {
  it('niepoprawny adres → mismatch bez wywołania bazy', async () => {
    expect(await deleteMyAccountAction('nie-adres')).toEqual({ ok: false, error: 'mismatch' });
    expect(await deleteMyAccountAction(undefined)).toEqual({ ok: false, error: 'mismatch' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('tryb demo: walidacja bez zapisu', async () => {
    fakeSession.configured = false;
    expect(await deleteMyAccountAction('ja@test.be')).toEqual({ ok: true, demo: true });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('wysyła przycięty adres do RPC pod sesją właściciela konta', async () => {
    outcome = { data: { erased: true } };
    expect(await deleteMyAccountAction('  Ja@Test.be ')).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith('request_account_erasure', { p_confirm_email: 'Ja@Test.be' });
    expect(fakeDb.callsTo('request_account_erasure')[0]?.as).toBe(SELF);
  });

  it('bez sesji → denied bez wywołania bazy', async () => {
    fakeSession.identity = null;
    expect(await deleteMyAccountAction('ja@test.be')).toEqual({ ok: false, error: 'denied' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['VALIDATION_FAILED: CONFIRMATION_MISMATCH', 'mismatch', false],
    ['PERMISSION_DENIED', 'denied', false],
    ['UNAUTHENTICATED', 'denied', false],
    ['deadlock detected', 'failed', true],
  ])('błąd RPC %s → %s', async (message, error, reported) => {
    outcome = { error: message };
    expect(await deleteMyAccountAction('ja@test.be')).toEqual({ ok: false, error });
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
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('tryb demo: plik z oznaczeniem demo', async () => {
    fakeSession.configured = false;
    const res = await exportData(exportRequest('https://pracuj.be'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="pracujbe-dane-\d{4}-\d{2}-\d{2}\.json"$/);
    expect(await res.json()).toMatchObject({ format: 'pracujbe-export/1', demo: true });
  });

  it('zwraca dane z RPC jako załącznik no-store', async () => {
    outcome = { data: { format: 'pracujbe-export/1', profile: { first_name: 'Ala' } } };
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
    outcome = { error: message };
    const res = await exportData(exportRequest('https://pracuj.be'));
    expect(res.status).toBe(status);
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({ error });
    expect(body).not.toContain('db.internal');
  });

  it('bez sesji → 401 bez odczytu danych', async () => {
    fakeSession.identity = null;
    const res = await exportData(exportRequest('https://pracuj.be'));
    expect(res.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
});

// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * #41 — publiczne zgłoszenie treści: kolejność ochron w Server Action (limiter → Turnstile →
 * walidacja) i kontrakt z RPC `submit_content_report` / `get_report_case` (0094).
 * Tożsamość zgłaszającego pochodzi z sesji serwera, nigdy z danych klienta.
 */

const mocks = vi.hoisted(() => ({
  rateLimit: vi.fn(async () => true),
  turnstile: vi.fn(async (): Promise<string | null> => null),
}));

vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mocks.rateLimit }));
vi.mock('@/lib/turnstile/verify', () => ({ enforceTurnstile: mocks.turnstile }));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));
vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());

import { lookupReportCase, submitContentReport } from '@/lib/actions/content-reports';
import { generateAccessCode } from '@/lib/validation/content-report';
import { fakeDb, fakeSession, pgError, resetFakeDb } from '../helpers/fake-db';

const USER = '7d7e5c1a-2b3c-4d5e-8f90-a1b2c3d4e5f6';

function rpcCalls(fn: string) {
  return fakeDb.callsTo(fn);
}

const JOB_ID = '5b0c8a1e-3f7a-4c52-9d1f-2a8e6b7c9d01';
const KEY = '0f9a5c3e-1b2d-4e6f-8a7b-9c0d1e2f3a4b';
const CODE = 'ABCDEFGHIJKLMNOPQRSTUVWX';

function input(overrides: Record<string, unknown> = {}) {
  return {
    target: 'job' as const,
    jobId: JOB_ID,
    category: 'fraud' as const,
    details: 'Oferta wymaga wpłaty przed rozmową kwalifikacyjną.',
    contentUrl: 'https://pracuj.be/pl/oferty-pracy/magazynier',
    reporterName: '',
    reporterEmail: 'gosc@example.com',
    goodFaith: true as const,
    locale: 'fr' as const,
    idempotencyKey: KEY,
    accessCode: CODE,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rateLimit.mockResolvedValue(true);
  mocks.turnstile.mockResolvedValue(null);
  resetFakeDb(null).rpc('submit_content_report', [
    { report_id: 'r1', case_number: 'DSA-1A2B-3C4D-5E6F-7A8B', created: true },
  ]);
});

describe('submitContentReport', () => {
  it('gość: RPC z reporterId = null, polami formularza i językiem formularza', async () => {
    const result = await submitContentReport(input(), 'token');
    expect(result).toEqual({ ok: true, caseNumber: 'DSA-1A2B-3C4D-5E6F-7A8B', created: true });
    expect(mocks.turnstile).toHaveBeenCalledWith('report', 'token');
    const [call] = rpcCalls('submit_content_report');
    // RPC tylko dla service_role — wywołanie w transakcji puli service, nie pod sesją.
    expect(call?.as).toBe('service');
    expect(call?.args).toEqual({
      p_reporter_id: null,
      p_idempotency_key: KEY,
      p_access_code: CODE,
      p_target_type: 'job',
      p_job_id: JOB_ID,
      p_category: 'fraud',
      p_details: 'Oferta wymaga wpłaty przed rozmową kwalifikacyjną.',
      p_content_url: 'https://pracuj.be/pl/oferty-pracy/magazynier',
      p_reporter_name: null,
      p_reporter_email: 'gosc@example.com',
      p_locale: 'fr',
      p_good_faith: true,
    });
  });

  it('zalogowany: reporterId z sesji serwera (klient nie może go podać)', async () => {
    fakeSession.identity = { id: USER, role: 'candidate' };
    await submitContentReport({ ...input(), reporterId: 'forged' } as never, null);
    expect(rpcCalls('submit_content_report')[0]?.args).toMatchObject({ p_reporter_id: USER });
  });

  it('limiter przed Turnstile i bazą', async () => {
    mocks.rateLimit.mockResolvedValue(false);
    expect(await submitContentReport(input(), 'token')).toEqual({ ok: false, error: 'RATE_LIMITED' });
    expect(mocks.turnstile).not.toHaveBeenCalled();
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('nieudany Turnstile (spam) zatrzymuje zgłoszenie przed bazą', async () => {
    mocks.turnstile.mockResolvedValue('BOT_CHECK_FAILED');
    expect(await submitContentReport(input(), 'zly')).toEqual({ ok: false, error: 'BOT_CHECK_FAILED' });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it.each([
    ['bez oświadczenia', { goodFaith: false }],
    ['za krótki opis', { details: 'krótko' }],
    ['adres spoza http(s)', { contentUrl: 'javascript:alert(1)' }],
    ['słaby kod dostępu', { accessCode: 'abc' }],
    ['kategoria spoza katalogu', { category: 'spam' }],
  ])('walidacja: %s → VALIDATION_FAILED bez RPC', async (_name, overrides) => {
    expect(await submitContentReport(input(overrides), 'token')).toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
    });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it.each([
    ['RATE_LIMITED', 'RATE_LIMITED'],
    ['NOT_FOUND', 'NOT_FOUND'],
    ['VALIDATION_FAILED: klucz idempotencji użyty z innym kodem', 'VALIDATION_FAILED'],
    ['relation "reports" violates check constraint', 'INTERNAL'],
  ])('błąd bazy „%s” → %s (bez technikaliów)', async (message, code) => {
    fakeDb.rpc('submit_content_report', () => {
      throw pgError('P0001', message);
    });
    expect(await submitContentReport(input(), 'token')).toEqual({ ok: false, error: code });
  });

  it('wyjątek spoza bazy (np. brak połączenia) → INTERNAL', async () => {
    fakeDb.rpc('submit_content_report', () => {
      throw new Error('connect ECONNREFUSED 10.0.0.1:5432 RATE_LIMITED');
    });
    expect(await submitContentReport(input(), 'token')).toEqual({ ok: false, error: 'INTERNAL' });
  });

  it('identyfikator spoza bazy → NOT_FOUND bez RPC (jak nieistniejąca treść)', async () => {
    expect(await submitContentReport(input({ jobId: '1 or 1=1' }), 'token')).toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('ponowienie z tym samym kluczem zwraca tę samą sprawę (created=false)', async () => {
    fakeDb.rpc('submit_content_report', [
      { report_id: 'r1', case_number: 'DSA-1A2B-3C4D-5E6F-7A8B', created: false },
    ]);
    expect(await submitContentReport(input(), 'token')).toEqual({
      ok: true,
      caseNumber: 'DSA-1A2B-3C4D-5E6F-7A8B',
      created: false,
    });
  });

  it('tryb demo: brak zapisu i jawny kod DEMO_UNAVAILABLE', async () => {
    fakeSession.serviceConfigured = false;
    expect(await submitContentReport(input(), 'token')).toEqual({ ok: false, error: 'DEMO_UNAVAILABLE' });
    expect(fakeDb.calls).toHaveLength(0);
  });
});

describe('lookupReportCase', () => {
  it('zły kod / obcy numer (null z RPC) → NOT_FOUND', async () => {
    fakeDb.rpc('get_report_case', null);
    expect(
      await lookupReportCase({ caseNumber: 'dsa-1a2b-3c4d-5e6f-7a8b', accessCode: 'abcd-efgh-ijkl-mnop-qrst-uvwx' }),
    ).toEqual({ ok: false, error: 'NOT_FOUND' });
    // Normalizacja: wielkie litery, kod bez myślników.
    expect(rpcCalls('get_report_case')).toEqual([
      expect.objectContaining({
        as: 'service',
        args: { p_case_number: 'DSA-1A2B-3C4D-5E6F-7A8B', p_access_code: CODE },
      }),
    ]);
  });

  it('poprawna sprawa → tylko stan sprawy; nieznane wartości odrzucone', async () => {
    fakeDb.rpc('get_report_case', {
        caseNumber: 'DSA-1A2B-3C4D-5E6F-7A8B',
        status: 'reviewing',
        targetType: 'company',
        category: 'impersonation',
        createdAt: '2026-09-20T10:00:00Z',
        dueAt: '2026-09-27T10:00:00Z',
        events: [
          { type: 'submitted', toStatus: 'open', at: '2026-09-20T10:00:00Z' },
          { type: 'hacked', toStatus: 'x', at: '2026-09-20T10:00:00Z' },
        ],
    });
    const result = await lookupReportCase({ caseNumber: 'DSA-1A2B-3C4D-5E6F-7A8B', accessCode: CODE });
    expect(result).toEqual({
      ok: true,
      report: {
        caseNumber: 'DSA-1A2B-3C4D-5E6F-7A8B',
        status: 'reviewing',
        targetType: 'company',
        category: 'impersonation',
        createdAt: '2026-09-20T10:00:00Z',
        dueAt: '2026-09-27T10:00:00Z',
        outcome: null,
        appealState: null,
        appealDeadline: null,
        appeal: null,
        restoration: null,
        events: [{ type: 'submitted', toStatus: 'open', at: '2026-09-20T10:00:00Z' }],
      },
    });
  });

  it('niepoprawny format → VALIDATION_FAILED bez RPC', async () => {
    expect(await lookupReportCase({ caseNumber: 'x', accessCode: CODE })).toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
    });
    expect(fakeDb.calls).toHaveLength(0);
  });
});

describe('kod dostępu', () => {
  it('24 znaki base32, za każdym razem inny', () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateAccessCode()));
    expect(codes.size).toBe(50);
    for (const code of codes) expect(code).toMatch(/^[A-Z2-7]{24}$/);
  });
});

describe('kontrakt z migracją 0094', () => {
  const sql = readdirSync(resolve(process.cwd(), 'supabase/migrations'))
    .filter((f) => f.startsWith('0094_'))
    .map((f) => readFileSync(resolve(process.cwd(), 'supabase/migrations', f), 'utf8'))
    .join('\n');

  it('RPC zgłoszeń wykonuje wyłącznie service_role (Turnstile i limiter nie do ominięcia)', () => {
    for (const fn of ['submit_content_report', 'get_report_case']) {
      const grants = sql.match(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\)\\s*to ([a-z_, ]+);`, 'g')) ?? [];
      expect(grants.length, fn).toBe(1);
      expect(grants[0]).toMatch(/to service_role;$/);
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\)\\s*from public, anon, authenticated;`));
    }
  });

  it('parametry akcji = parametry RPC', () => {
    const signature = sql.match(/function public\.submit_content_report\(([\s\S]*?)\) returns/)?.[1] ?? '';
    const params = [...signature.matchAll(/(p_[a-z_]+)\s/g)].map((m) => m[1]).sort();
    expect(params).toEqual(
      [
        'p_reporter_id', 'p_idempotency_key', 'p_access_code', 'p_target_type', 'p_job_id', 'p_category',
        'p_details', 'p_content_url', 'p_reporter_name', 'p_reporter_email', 'p_locale', 'p_good_faith',
      ].sort(),
    );
  });
});

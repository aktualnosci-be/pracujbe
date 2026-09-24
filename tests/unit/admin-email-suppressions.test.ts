import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { liftEmailSuppression } from '@/lib/actions/admin';
import { EMAIL_LIFT_REASON_MAX, emailLiftReasonError } from '@/lib/admin/email-suppression';
import {
  AUDIT_ACTION_KEY,
  EMAIL_SUPPRESSION_REASON_KEY,
  parseEmailSuppressionFilter,
} from '@/lib/admin/list-params';
import { listEmailSuppressions } from '@/lib/data/admin';
import { isSupabaseConfigured } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerClient } from '@/lib/supabase/server';

/**
 * #44 — panel admina: podgląd blokad adresów e-mail i ręczne zdjęcie blokady
 * z uzasadnieniem (akcja + reguły wspólne z dialogiem + kontrakt z migracją 0099).
 */

vi.mock('@/lib/env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/env')>()),
  isSupabaseConfigured: vi.fn(),
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }));
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));

const SUPPRESSION_ID = '5a0e8f4c-2b1d-4c3e-9f7a-1d2e3f4a5b6c';
const MIGRATION = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/0099_email_delivery_events.sql'),
  'utf8',
);

type Result = { data?: unknown; error?: unknown };

function chain(result: Result, calls: string[] = []) {
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'is', 'not', 'eq', 'in', 'or', 'order', 'limit']) {
    q[m] = (...args: unknown[]) => {
      calls.push(`${m}:${JSON.stringify(args)}`);
      return q;
    };
  }
  q.maybeSingle = () => Promise.resolve(result);
  q.then = (done: (value: Result) => unknown) => Promise.resolve(result).then(done);
  return q;
}

function mockSession(role: string | null, rpcResult: { error: unknown } = { error: null }) {
  const rpc = vi.fn().mockResolvedValue(rpcResult);
  vi.mocked(createServerClient).mockResolvedValue({
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'admin-1' } } }) },
    from: vi.fn(() => chain({ data: role ? { role } : null, error: null })),
    rpc,
  } as never);
  return rpc;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isSupabaseConfigured).mockReturnValue(true);
});

describe('reguły uzasadnienia zdjęcia blokady', () => {
  it('puste/białe znaki → required, ponad limit → tooLong, poprawne → null', () => {
    expect(emailLiftReasonError('')).toBe('required');
    expect(emailLiftReasonError('   ')).toBe('required');
    expect(emailLiftReasonError('x'.repeat(EMAIL_LIFT_REASON_MAX + 1))).toBe('tooLong');
    expect(emailLiftReasonError('Użytkownik potwierdził adres')).toBeNull();
  });

  it('limit zgodny z RPC i CHECK tabeli w migracji 0099', () => {
    expect(MIGRATION).toContain(`char_length(v_reason) > ${EMAIL_LIFT_REASON_MAX}`);
    expect(MIGRATION).toContain(`between 1 and ${EMAIL_LIFT_REASON_MAX}))`);
  });
});

describe('liftEmailSuppression', () => {
  it('woła RPC pod sesją admina z przyciętym uzasadnieniem', async () => {
    const rpc = mockSession('admin');
    await expect(liftEmailSuppression(SUPPRESSION_ID, '  Adres potwierdzony  ')).resolves.toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith('admin_lift_email_suppression', {
      p_id: SUPPRESSION_ID,
      p_reason: 'Adres potwierdzony',
    });
  });

  it('KONTROLA UJEMNA: bez uzasadnienia i ze złym id — bez wywołania RPC', async () => {
    const rpc = mockSession('admin');
    await expect(liftEmailSuppression(SUPPRESSION_ID, ' ')).resolves.toMatchObject({
      ok: false,
      field: 'reason',
      reason: 'required',
    });
    await expect(liftEmailSuppression('nie-uuid', 'powód')).resolves.toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('błędy RPC → stabilne kody (STALE_STATE, PERMISSION_DENIED, pole uzasadnienia)', async () => {
    mockSession('admin', { error: { message: 'STALE_STATE' } });
    await expect(liftEmailSuppression(SUPPRESSION_ID, 'powód')).resolves.toEqual({ ok: false, error: 'STALE_STATE' });
    mockSession('candidate', { error: { message: 'PERMISSION_DENIED' } });
    await expect(liftEmailSuppression(SUPPRESSION_ID, 'powód')).resolves.toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    mockSession('admin', { error: { message: 'VALIDATION_FAILED: REASON_TOO_LONG' } });
    await expect(liftEmailSuppression(SUPPRESSION_ID, 'powód')).resolves.toMatchObject({ reason: 'tooLong' });
  });

  it('tryb demo nic nie zapisuje', async () => {
    vi.mocked(isSupabaseConfigured).mockReturnValue(false);
    await expect(liftEmailSuppression('demo-s1', 'powód')).resolves.toEqual({ ok: true, demo: true });
    expect(createServerClient).not.toHaveBeenCalled();
  });
});

describe('listEmailSuppressions', () => {
  it('bez roli admina → notFound przed odczytem service-role', async () => {
    mockSession('employer');
    await expect(listEmailSuppressions()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('domyślnie tylko aktywne blokady; nazwa admina, który zdjął blokadę', async () => {
    mockSession('admin');
    const calls: string[] = [];
    vi.mocked(createAdminClient).mockReturnValue({
      from: (table: string) =>
        table === 'email_suppressions'
          ? chain(
              {
                data: [
                  {
                    id: SUPPRESSION_ID,
                    email: 'a@example.com',
                    reason: 'complaint',
                    created_at: '2026-09-24T10:00:00.000000+00:00',
                    lifted_at: null,
                    lifted_by: null,
                    lift_reason: null,
                  },
                ],
                error: null,
              },
              calls,
            )
          : chain({ data: [], error: null }),
    } as never);
    const result = await listEmailSuppressions({ status: 'nieznany' });
    expect(calls).toContain('is:["lifted_at",null]');
    expect(result).toMatchObject({
      status: 'ok',
      rows: [{ id: SUPPRESSION_ID, email: 'a@example.com', reason: 'complaint', liftedAt: null }],
      nextCursor: null,
    });
  });

  it('demo: filtr zdjętych i wyszukiwanie', async () => {
    vi.mocked(isSupabaseConfigured).mockReturnValue(false);
    const lifted = await listEmailSuppressions({ status: 'lifted' });
    expect(lifted.status === 'ok' && lifted.rows.every((r) => r.liftedAt !== null)).toBe(true);
    const found = await listEmailSuppressions({ status: 'all', q: 'skarga' });
    expect(found.status === 'ok' && found.rows.map((r) => r.reason)).toEqual(['complaint']);
  });
});

describe('słowniki i kontrakt z migracją', () => {
  it('filtr: domyślnie aktywne', () => {
    expect(parseEmailSuppressionFilter(undefined)).toBe('active');
    expect(parseEmailSuppressionFilter('lifted')).toBe('lifted');
    expect(parseEmailSuppressionFilter('x')).toBe('active');
  });

  it('powody i akcje audytu z migracji mają etykiety i18n', () => {
    const reasons = MIGRATION.match(/reason in \(([^)]+)\)/)?.[1] ?? '';
    for (const r of reasons.split(',').map((s) => s.trim().replace(/'/g, ''))) {
      expect(EMAIL_SUPPRESSION_REASON_KEY[r], r).toBeTruthy();
    }
    for (const action of ['email.suppressed', 'email.suppression_lifted']) {
      expect(MIGRATION).toContain(`'${action}'`);
      expect(AUDIT_ACTION_KEY[action], action).toBeTruthy();
    }
  });

  it('etykiety istnieją we wszystkich językach', () => {
    for (const locale of ['pl', 'nl', 'fr', 'en']) {
      const admin = JSON.parse(
        readFileSync(resolve(process.cwd(), `src/messages/${locale}.json`), 'utf8'),
      ).admin as Record<string, string>;
      for (const key of [
        ...Object.values(EMAIL_SUPPRESSION_REASON_KEY),
        AUDIT_ACTION_KEY['email.suppressed']!,
        AUDIT_ACTION_KEY['email.suppression_lifted']!,
        'navEmail',
        'emailTitle',
        'emailActionLift',
      ]) {
        expect(admin[key], `${locale}.admin.${key}`).toBeTruthy();
      }
    }
  });
});

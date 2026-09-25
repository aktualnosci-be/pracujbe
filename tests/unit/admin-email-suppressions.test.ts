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
import { fakeDb, fakeSession, pgError, resetFakeDb } from '../helpers/fake-db';

/**
 * #44 — panel admina: podgląd blokad adresów e-mail i ręczne zdjęcie blokady
 * z uzasadnieniem (akcja + reguły wspólne z dialogiem + kontrakt z migracją 0098).
 */

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));

const SUPPRESSION_ID = '5a0e8f4c-2b1d-4c3e-9f7a-1d2e3f4a5b6c';
const ADMIN_ID = '00000000-0000-4000-8000-00000000a001';
const MIGRATION = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/0098_email_delivery_events.sql'),
  'utf8',
);

/** Sesja z rolą; RPC `admin_lift_email_suppression` zwraca void albo rzuca błąd bazy. */
function mockSession(role: 'admin' | 'candidate' | 'employer' | null, rpcError?: string) {
  resetFakeDb(role ? { id: ADMIN_ID, role } : null);
  fakeDb.rpc('admin_lift_email_suppression', () => {
    if (rpcError) throw pgError('P0001', rpcError);
    return null;
  });
  return () => fakeDb.callsTo('admin_lift_email_suppression');
}

beforeEach(() => {
  vi.clearAllMocks();
  resetFakeDb(null);
});

describe('reguły uzasadnienia zdjęcia blokady', () => {
  it('puste/białe znaki → required, ponad limit → tooLong, poprawne → null', () => {
    expect(emailLiftReasonError('')).toBe('required');
    expect(emailLiftReasonError('   ')).toBe('required');
    expect(emailLiftReasonError('x'.repeat(EMAIL_LIFT_REASON_MAX + 1))).toBe('tooLong');
    expect(emailLiftReasonError('Użytkownik potwierdził adres')).toBeNull();
  });

  it('limit zgodny z RPC i CHECK tabeli w migracji 0098', () => {
    expect(MIGRATION).toContain(`char_length(v_reason) > ${EMAIL_LIFT_REASON_MAX}`);
    expect(MIGRATION).toContain(`between 1 and ${EMAIL_LIFT_REASON_MAX}))`);
  });
});

describe('liftEmailSuppression', () => {
  it('woła RPC pod sesją admina z przyciętym uzasadnieniem', async () => {
    const rpc = mockSession('admin');
    await expect(liftEmailSuppression(SUPPRESSION_ID, '  Adres potwierdzony  ')).resolves.toEqual({ ok: true });
    expect(rpc()).toHaveLength(1);
    expect(rpc()[0]).toMatchObject({
      as: ADMIN_ID,
      args: { p_id: SUPPRESSION_ID, p_reason: 'Adres potwierdzony' },
    });
  });

  it('bez sesji → PERMISSION_DENIED bez wywołania RPC', async () => {
    const rpc = mockSession(null);
    await expect(liftEmailSuppression(SUPPRESSION_ID, 'powód')).resolves.toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    expect(rpc()).toHaveLength(0);
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
    expect(rpc()).toHaveLength(0);
  });

  it('błędy RPC → stabilne kody (STALE_STATE, PERMISSION_DENIED, pole uzasadnienia)', async () => {
    mockSession('admin', 'STALE_STATE');
    await expect(liftEmailSuppression(SUPPRESSION_ID, 'powód')).resolves.toEqual({ ok: false, error: 'STALE_STATE' });
    mockSession('candidate', 'PERMISSION_DENIED');
    await expect(liftEmailSuppression(SUPPRESSION_ID, 'powód')).resolves.toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    mockSession('admin', 'VALIDATION_FAILED: REASON_TOO_LONG');
    await expect(liftEmailSuppression(SUPPRESSION_ID, 'powód')).resolves.toMatchObject({ reason: 'tooLong' });
  });

  it('tryb demo nic nie zapisuje', async () => {
    mockSession('admin');
    fakeSession.configured = false;
    await expect(liftEmailSuppression('demo-s1', 'powód')).resolves.toEqual({ ok: true, demo: true });
    expect(fakeDb.calls).toHaveLength(0);
  });
});

describe('listEmailSuppressions', () => {
  it('bez roli admina → notFound przed odczytem service-role', async () => {
    mockSession('employer');
    await expect(listEmailSuppressions()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('domyślnie tylko aktywne blokady; nazwa admina, który zdjął blokadę', async () => {
    mockSession('admin');
    fakeDb.rows('admin.email-suppressions', [
      {
        id: SUPPRESSION_ID,
        email: 'a@example.com',
        reason: 'complaint',
        created_at: '2026-09-24T10:00:00.000000+00:00',
        lifted_at: null,
        lifted_by: null,
        lift_reason: null,
      },
    ]);
    const result = await listEmailSuppressions({ status: 'nieznany' });
    const call = fakeDb.callsTo('admin.email-suppressions')[0]!;
    expect(call.as).toBe('service');
    expect(call.text).toContain('lifted_at IS NULL');
    expect(result).toMatchObject({
      status: 'ok',
      rows: [{ id: SUPPRESSION_ID, email: 'a@example.com', reason: 'complaint', liftedAt: null }],
      nextCursor: null,
    });
    // Bez `lifted_by` nie czytamy profili.
    expect(fakeDb.callsTo('admin.email-suppression-admins')).toHaveLength(0);
  });

  it('zdjęte: filtr, wyszukiwanie po adresie i nazwa admina', async () => {
    mockSession('admin');
    fakeDb
      .rows('admin.email-suppressions', [
        {
          id: SUPPRESSION_ID,
          email: 'a@example.com',
          reason: 'hard_bounce',
          created_at: '2026-09-24T10:00:00.000000+00:00',
          lifted_at: '2026-09-24T11:00:00.000000+00:00',
          lifted_by: ADMIN_ID,
          lift_reason: 'Adres potwierdzony',
        },
      ])
      .rows('admin.email-suppression-admins', [{ id: ADMIN_ID, first_name: 'Ada', last_name: 'Admin' }]);
    const result = await listEmailSuppressions({ status: 'lifted', q: 'a@example' });
    const call = fakeDb.callsTo('admin.email-suppressions')[0]!;
    expect(call.text).toContain('lifted_at IS NOT NULL');
    expect(call.text).toContain('email::text ILIKE $1');
    expect(call.values[0]).toBe('%a@example%');
    expect(fakeDb.callsTo('admin.email-suppression-admins')[0]?.values).toEqual([[ADMIN_ID]]);
    expect(result).toMatchObject({ status: 'ok', rows: [{ liftedByName: 'Ada Admin' }] });
  });

  it('demo: filtr zdjętych i wyszukiwanie', async () => {
    fakeSession.configured = false;
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

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { decideCompanyDescription } from '@/lib/actions/admin';
import { AUDIT_ACTION_KEY } from '@/lib/admin/list-params';
import { titleKeyForType } from '@/lib/data/notifications';
import { fakeDb, pgError, resetFakeDb } from '../helpers/fake-db';

/**
 * Zatwierdzanie opisu firmy przez admina (0971, #868): akcja waliduje uzasadnienie przed bazą
 * (te same reguły co RPC), przekazuje znacznik CAS i mapuje odpowiedzi RPC; tytuł powiadomienia
 * firmy i etykiety dziennika dla nowych akcji audytu.
 */

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const COMPANY_ID = '7c2a0b6e-4d3f-4e5a-9b8c-3f4a5b6c7d8e';
const SUBMITTED_AT = '2026-09-29 10:00:00.123+00';

beforeEach(() => {
  vi.clearAllMocks();
  resetFakeDb({ id: '11111111-1111-4111-8111-111111111111', role: 'admin' });
});

describe('decideCompanyDescription', () => {
  it('approval calls the RPC with the CAS timestamp and no reason', async () => {
    fakeDb.rpc('admin_decide_company_description', null);
    expect(await decideCompanyDescription(COMPANY_ID, 'approved', SUBMITTED_AT, '  ')).toEqual({ ok: true });
    expect(fakeDb.callsTo('admin_decide_company_description')[0]?.args).toEqual({
      p_company_id: COMPANY_ID,
      p_decision: 'approved',
      p_expected_pending_at: SUBMITTED_AT,
      p_reason: null,
    });
  });

  it('rejection requires a reason before touching the database (negative control)', async () => {
    expect(await decideCompanyDescription(COMPANY_ID, 'rejected', SUBMITTED_AT, '   ')).toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
      field: 'reason',
      reason: 'required',
    });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('rejection with a reason is passed trimmed', async () => {
    fakeDb.rpc('admin_decide_company_description', null);
    expect(await decideCompanyDescription(COMPANY_ID, 'rejected', SUBMITTED_AT, ' Dane kontaktowe. ')).toEqual({
      ok: true,
    });
    expect(fakeDb.callsTo('admin_decide_company_description')[0]?.args).toMatchObject({
      p_decision: 'rejected',
      p_reason: 'Dane kontaktowe.',
    });
  });

  it('maps a stale proposal (CAS) and a missing admin role to user codes', async () => {
    fakeDb.rpc('admin_decide_company_description', () => {
      throw pgError('P0001', 'STALE_STATE: propozycja opisu firmy zmieniła się albo już rozstrzygnięta');
    });
    expect(await decideCompanyDescription(COMPANY_ID, 'approved', SUBMITTED_AT, '')).toEqual({
      ok: false,
      error: 'STALE_STATE',
    });
    fakeDb.rpc('admin_decide_company_description', () => {
      throw pgError('42501', 'PERMISSION_DENIED');
    });
    expect(await decideCompanyDescription(COMPANY_ID, 'approved', SUBMITTED_AT, '')).toEqual({
      ok: false,
      error: 'PERMISSION_DENIED',
    });
  });

  it('rejects malformed input without calling the database', async () => {
    expect(await decideCompanyDescription('nie-uuid', 'approved', SUBMITTED_AT, '')).toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
    });
    expect(await decideCompanyDescription(COMPANY_ID, 'approved', '', '')).toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
    });
    expect(fakeDb.calls).toHaveLength(0);
  });
});

describe('notifications and audit labels for the description review', () => {
  it('maps the decision to the notification title, other kinds are untouched', () => {
    expect(titleKeyForType('system', { kind: 'company_description', status: 'approved' }, 'company')).toBe(
      'itemCompanyDescriptionApproved',
    );
    expect(titleKeyForType('system', { kind: 'company_description', status: 'rejected' }, 'company')).toBe(
      'itemCompanyDescriptionRejected',
    );
    // Kontrola ujemna: nieznany status nie dostaje tytułu opisu, linki mają własny.
    expect(titleKeyForType('system', { kind: 'company_description', status: 'x' }, 'company')).toBe('itemSystem');
    expect(titleKeyForType('system', { kind: 'company_links', status: 'approved' }, 'company')).toBe(
      'itemCompanyLinksApproved',
    );
  });

  it('labels every new audit action', () => {
    expect(AUDIT_ACTION_KEY['company.description_submitted']).toBe('auditActionCompanyDescriptionSubmitted');
    expect(AUDIT_ACTION_KEY['company.description_removed']).toBe('auditActionCompanyDescriptionRemoved');
    expect(AUDIT_ACTION_KEY['company.description_reviewed']).toBe('auditActionCompanyDescriptionReviewed');
  });
});

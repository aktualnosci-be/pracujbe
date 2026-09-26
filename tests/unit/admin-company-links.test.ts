import { beforeEach, describe, expect, it, vi } from 'vitest';

import { decideCompanyLinks } from '@/lib/actions/admin';
import { AUDIT_ACTION_KEY } from '@/lib/admin/list-params';
import { companyLinksReasonError, COMPANY_LINKS_REASON_MAX, parseCompanyLinksReview } from '@/lib/company-links';
import { titleKeyForType } from '@/lib/data/notifications';
import { fakeDb, pgError, resetFakeDb } from '../helpers/fake-db';

/**
 * Zatwierdzanie strony WWW/logo firmy przez admina (0204): akcja waliduje uzasadnienie przed
 * bazą (te same reguły co RPC), przekazuje znacznik CAS i mapuje odpowiedzi RPC; tytuł
 * powiadomienia firmy i etykiety dziennika dla nowych akcji audytu.
 */

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const COMPANY_ID = '7c2a0b6e-4d3f-4e5a-9b8c-3f4a5b6c7d8e';
const SUBMITTED_AT = '2026-09-26 10:00:00.123+00';

beforeEach(() => {
  vi.clearAllMocks();
  resetFakeDb({ id: '11111111-1111-4111-8111-111111111111', role: 'admin' });
});

describe('decideCompanyLinks', () => {
  it('approval calls the RPC with the CAS timestamp and no reason', async () => {
    fakeDb.rpc('admin_decide_company_links', null);
    expect(await decideCompanyLinks(COMPANY_ID, 'approved', SUBMITTED_AT, '  ')).toEqual({ ok: true });
    expect(fakeDb.callsTo('admin_decide_company_links')[0]?.args).toEqual({
      p_company_id: COMPANY_ID,
      p_decision: 'approved',
      p_expected_pending_at: SUBMITTED_AT,
      p_reason: null,
    });
  });

  it('rejection requires a reason before touching the database (negative control)', async () => {
    expect(await decideCompanyLinks(COMPANY_ID, 'rejected', SUBMITTED_AT, '   ')).toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
      field: 'reason',
      reason: 'required',
    });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('rejection with a reason is passed trimmed', async () => {
    fakeDb.rpc('admin_decide_company_links', null);
    expect(await decideCompanyLinks(COMPANY_ID, 'rejected', SUBMITTED_AT, ' Obca domena. ')).toEqual({ ok: true });
    expect(fakeDb.callsTo('admin_decide_company_links')[0]?.args).toMatchObject({
      p_decision: 'rejected',
      p_reason: 'Obca domena.',
    });
  });

  it('maps a stale proposal (CAS) and a missing admin role to user codes', async () => {
    fakeDb.rpc('admin_decide_company_links', () => {
      throw pgError('P0001', 'STALE_STATE: propozycja linków firmy zmieniła się albo już rozstrzygnięta');
    });
    expect(await decideCompanyLinks(COMPANY_ID, 'approved', SUBMITTED_AT, '')).toEqual({
      ok: false,
      error: 'STALE_STATE',
    });
    fakeDb.rpc('admin_decide_company_links', () => {
      throw pgError('42501', 'PERMISSION_DENIED');
    });
    expect(await decideCompanyLinks(COMPANY_ID, 'approved', SUBMITTED_AT, '')).toEqual({
      ok: false,
      error: 'PERMISSION_DENIED',
    });
  });

  it('rejects malformed input without calling the database', async () => {
    expect(await decideCompanyLinks('nie-uuid', 'approved', SUBMITTED_AT, '')).toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
    });
    expect(await decideCompanyLinks(COMPANY_ID, 'approved', '', '')).toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
    });
    expect(
      await decideCompanyLinks(COMPANY_ID, 'maybe' as 'approved', SUBMITTED_AT, ''),
    ).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(fakeDb.calls).toHaveLength(0);
  });
});

describe('company links review helpers', () => {
  it('reason rules mirror the RPC', () => {
    expect(companyLinksReasonError('approved', '')).toBeNull();
    expect(companyLinksReasonError('rejected', '')).toBe('required');
    expect(companyLinksReasonError('rejected', 'x'.repeat(COMPANY_LINKS_REASON_MAX))).toBeNull();
    expect(companyLinksReasonError('rejected', 'x'.repeat(COMPANY_LINKS_REASON_MAX + 1))).toBe('tooLong');
  });

  it('a pending proposal never carries a stale rejection reason', () => {
    expect(
      parseCompanyLinksReview({ links_review_status: 'pending', links_review_reason: 'stare', website_pending: 'https://a.example' }),
    ).toMatchObject({ status: 'pending', reason: null, website: 'https://a.example', logoUrl: null });
    expect(parseCompanyLinksReview({ links_review_status: null })).toBeNull();
  });

  it('notification title follows the admin decision', () => {
    const data = (status: string) => ({ kind: 'company_links', status });
    expect(titleKeyForType('system', data('approved'), 'company')).toBe('itemCompanyLinksApproved');
    expect(titleKeyForType('system', data('rejected'), 'company')).toBe('itemCompanyLinksRejected');
    // Kontrola ujemna: nieznany status → ogólny tytuł, nie „zatwierdzone”.
    expect(titleKeyForType('system', data('other'), 'company')).toBe('itemSystem');
  });

  it('audit log labels exist for the new actions', () => {
    expect(AUDIT_ACTION_KEY['company.links_changed']).toBeDefined();
    expect(AUDIT_ACTION_KEY['company.links_submitted']).toBeDefined();
    expect(AUDIT_ACTION_KEY['company.links_reviewed']).toBeDefined();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { reviewCompanyLink } from '@/lib/actions/admin';
import {
  COMPANY_LINK_REASON_MAX,
  companyLinkReasonError,
} from '@/lib/admin/company-link-review';
import { AUDIT_ACTION_KEY } from '@/lib/admin/list-params';
import { fakeDb, pgError, resetFakeDb } from '../helpers/fake-db';

/**
 * 0144 — „linki do zatwierdzenia”: akcja admina `reviewCompanyLink` (walidacja przed bazą,
 * CAS po zgłoszonym adresie, mapowanie błędów) i wspólna reguła uzasadnienia.
 */

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

const COMPANY_ID = '7c2a0b6e-4d3f-4e5a-9b8c-3f4a5b6c7d8e';
const URL = 'https://acme.example';

function mockRpc(result: { error: string | null } = { error: null }) {
  const rpc = vi.fn();
  fakeDb.rpc('admin_review_company_link', ({ args }: { args: Record<string, unknown> }) => {
    rpc(args);
    if (result.error) throw pgError('P0001', result.error);
    return null;
  });
  return rpc;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetFakeDb({ id: '22222222-2222-4222-8222-222222222222', role: 'admin' });
});

describe('companyLinkReasonError', () => {
  it('odrzucenie wymaga uzasadnienia, akceptacja nie', () => {
    expect(companyLinkReasonError('reject', '  ')).toBe('required');
    expect(companyLinkReasonError('approve', '')).toBeNull();
    expect(companyLinkReasonError('reject', 'x'.repeat(COMPANY_LINK_REASON_MAX + 1))).toBe('tooLong');
    expect(companyLinkReasonError('reject', 'Adres nie prowadzi do firmy')).toBeNull();
  });
});

describe('reviewCompanyLink', () => {
  it('zatwierdzenie → RPC z oczekiwanym adresem (CAS) i pustym uzasadnieniem', async () => {
    const rpc = mockRpc();
    await expect(reviewCompanyLink(COMPANY_ID, 'website', 'approve', URL, ' ')).resolves.toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith({
      p_company_id: COMPANY_ID,
      p_field: 'website',
      p_decision: 'approve',
      p_expected_value: URL,
      p_reason: null,
    });
  });

  it('odrzucenie bez uzasadnienia nie dociera do bazy', async () => {
    const rpc = mockRpc();
    await expect(reviewCompanyLink(COMPANY_ID, 'logo_url', 'reject', URL, '')).resolves.toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
      field: 'reason',
      reason: 'required',
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('nieznane pole/decyzja, pusty adres, zły identyfikator → VALIDATION_FAILED bez RPC', async () => {
    const rpc = mockRpc();
    for (const call of [
      () => reviewCompanyLink(COMPANY_ID, 'name' as never, 'approve', URL, ''),
      () => reviewCompanyLink(COMPANY_ID, 'website', 'maybe' as never, URL, ''),
      () => reviewCompanyLink(COMPANY_ID, 'website', 'approve', '', ''),
      () => reviewCompanyLink('nie-uuid', 'website', 'approve', URL, ''),
    ]) {
      await expect(call()).resolves.toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it('firma zmieniła zgłoszenie w międzyczasie → STALE_STATE', async () => {
    mockRpc({ error: 'STALE_STATE' });
    await expect(reviewCompanyLink(COMPANY_ID, 'website', 'approve', URL, '')).resolves.toEqual({
      ok: false,
      error: 'STALE_STATE',
    });
  });

  it('konto bez roli admina → PERMISSION_DENIED; uzasadnienie z bazy → błąd przy polu', async () => {
    mockRpc({ error: 'PERMISSION_DENIED: tylko administrator' });
    await expect(reviewCompanyLink(COMPANY_ID, 'website', 'approve', URL, '')).resolves.toEqual({
      ok: false,
      error: 'PERMISSION_DENIED',
    });
    mockRpc({ error: 'VALIDATION_FAILED: REASON_TOO_LONG' });
    await expect(reviewCompanyLink(COMPANY_ID, 'website', 'reject', URL, 'x')).resolves.toMatchObject({
      field: 'reason',
      reason: 'tooLong',
    });
  });

  it('dziennik zdarzeń ma etykiety akcji linków', () => {
    expect(AUDIT_ACTION_KEY['company.link_reviewed']).toBe('auditActionCompanyLinkReviewed');
    expect(AUDIT_ACTION_KEY['company.links_changed']).toBe('auditActionCompanyLinks');
  });
});

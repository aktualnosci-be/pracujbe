// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Locale } from '@/i18n/routing';
import { renderEmail } from '@/emails/templates';
import {
  APPEAL_GROUNDS_MAX,
  appealDecisionError,
  appealFieldFromDbMessage,
  appealGroundsError,
  appealRestrictionsForTarget,
  parseAppealState,
} from '@/lib/admin/appeals';
import { parseDsaReportRange } from '@/lib/admin/dsa-report';
import { parseReportCase } from '@/lib/content-reports/case';
import { parseTransparencyReport, toCsv, DSA_EXPORT_COLUMNS, type DsaExportRow } from '@/lib/data/admin-dsa';
import { titleKeyForType } from '@/lib/data/notifications';
import { buildDeliveryData, emailTargetPath } from '@/lib/email/delivery-data';

/**
 * #43 — odwołania od decyzji moderacyjnych: reguły wspólne z formularzami i bazą (0104),
 * akcje wołające jedno RPC z mapowaniem błędów, e-maile w języku odbiorcy bez danych drugiej
 * strony, widok sprawy zgłaszającego, raport przejrzystości i eksport bez danych osobowych.
 */

const mocks = vi.hoisted(() => ({
  rateLimit: vi.fn(async () => true),
  configured: vi.fn(() => true),
  adminRpc: vi.fn(),
  sessionRpc: vi.fn(),
  getUser: vi.fn(async () => ({ data: { user: { id: 'u1' } as { id: string } | null } })),
}));

vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mocks.rateLimit }));
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));
vi.mock('@/lib/env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/env')>()),
  isSupabaseConfigured: mocks.configured,
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ rpc: mocks.adminRpc }) }));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getUser: mocks.getUser }, rpc: mocks.sessionRpc }),
}));

import { decideAppeal, submitModerationAppeal, submitReportAppeal } from '@/lib/actions/appeals';

const DECISION = '5b0c8a1e-3f7a-4c52-9d1f-2a8e6b7c9d01';
const APPEAL = '6c1d9b2f-4a8b-4d63-8e2a-3b9f7c8d0e12';
const KEY = '0f9a5c3e-1b2d-4e6f-8a7b-9c0d1e2f3a4b';
const CODE = 'ABCDEFGHIJKLMNOPQRSTUVWX';
const GROUNDS = 'Nie pobieramy opłat od kandydatów; to był błąd w szablonie.';
const REASONING = 'Autor wykazał, że opłata nie była pobierana od kandydatów.';
const SITE = 'https://pracuj.be';
const LOCALES: Locale[] = ['pl', 'nl', 'fr', 'en'];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rateLimit.mockResolvedValue(true);
  mocks.configured.mockReturnValue(true);
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
  mocks.sessionRpc.mockResolvedValue({ data: [{ appeal_id: APPEAL, reference: 'APL-6C1D-9B2F-4A8B', created: true }], error: null });
  mocks.adminRpc.mockResolvedValue({ data: [{ appeal_id: APPEAL, reference: 'APL-6C1D-9B2F-4A8B', created: true }], error: null });
});

describe('reguły odwołania', () => {
  it('uzasadnienie odwołania: wymagane, 20–2000 znaków', () => {
    expect(appealGroundsError('')).toBe('required');
    expect(appealGroundsError('za krótko')).toBe('tooShort');
    expect(appealGroundsError('x'.repeat(APPEAL_GROUNDS_MAX + 1))).toBe('tooLong');
    expect(appealGroundsError(GROUNDS)).toBeNull();
  });

  it('uwzględnienie odwołania zgłaszającego wymaga nowego ograniczenia z podstawą; autora — nie', () => {
    const base = { outcome: 'reversed', reasoning: REASONING };
    expect(appealDecisionError(base, 'author', 'job')).toBeNull();
    expect(appealDecisionError(base, 'reporter', 'job')).toEqual({ field: 'decision', error: 'required' });
    expect(appealDecisionError({ ...base, decision: 'job_removed' }, 'reporter', 'company')).toEqual({
      field: 'decision',
      error: 'scope',
    });
    expect(appealDecisionError({ ...base, decision: 'job_removed' }, 'reporter', 'job')).toEqual({
      field: 'groundType',
      error: 'required',
    });
    expect(
      appealDecisionError(
        { ...base, decision: 'job_removed', groundType: 'terms', groundReference: '§ 4' },
        'reporter',
        'job',
      ),
    ).toBeNull();
    expect(appealDecisionError({ outcome: 'upheld', reasoning: 'krótko' }, 'reporter', 'job')).toEqual({
      field: 'reasoning',
      error: 'tooShort',
    });
    expect(appealDecisionError({ outcome: 'maybe', reasoning: REASONING }, 'author', 'job')?.field).toBe('outcome');
    expect(appealRestrictionsForTarget('company')).toEqual(['company_suspended']);
  });

  it('błędy RPC → pola; stan drogi odwołania tylko z listy', () => {
    expect(appealFieldFromDbMessage('VALIDATION_FAILED: GROUNDS_REQUIRED')).toEqual({ field: 'grounds', error: 'tooShort' });
    expect(appealFieldFromDbMessage('VALIDATION_FAILED: GROUND_REFERENCE_REQUIRED')?.field).toBe('groundReference');
    expect(appealFieldFromDbMessage('VALIDATION_FAILED: DECISION')?.field).toBe('decision');
    expect(parseAppealState('APPEAL_WINDOW_CLOSED')).toBe('APPEAL_WINDOW_CLOSED');
    expect(parseAppealState('surowy_kod')).toBeNull();
  });
});

describe('akcje odwołań', () => {
  it('autor: jedno RPC pod sesją z kluczem idempotencji', async () => {
    expect(await submitModerationAppeal(DECISION, `  ${GROUNDS}  `, KEY)).toEqual({
      ok: true,
      reference: 'APL-6C1D-9B2F-4A8B',
      created: true,
    });
    expect(mocks.sessionRpc).toHaveBeenCalledWith('submit_moderation_appeal', {
      p_decision_id: DECISION,
      p_idempotency_key: KEY,
      p_grounds: GROUNDS,
    });
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it('autor: błędy bazy → kody użytkowe, walidacja przed RPC', async () => {
    mocks.sessionRpc.mockResolvedValueOnce({ data: null, error: { message: 'APPEAL_EXISTS' } });
    expect(await submitModerationAppeal(DECISION, GROUNDS, KEY)).toEqual({ ok: false, error: 'APPEAL_EXISTS' });
    mocks.sessionRpc.mockResolvedValueOnce({ data: null, error: { message: 'APPEAL_WINDOW_CLOSED' } });
    expect(await submitModerationAppeal(DECISION, GROUNDS, KEY)).toEqual({ ok: false, error: 'APPEAL_WINDOW_CLOSED' });
    mocks.sessionRpc.mockClear();
    expect(await submitModerationAppeal(DECISION, 'krótko', KEY)).toMatchObject({ field: 'grounds', fieldError: 'tooShort' });
    expect(await submitModerationAppeal(DECISION, GROUNDS, 'nie-uuid')).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(mocks.sessionRpc).not.toHaveBeenCalled();
    mocks.getUser.mockResolvedValueOnce({ data: { user: null } });
    expect(await submitModerationAppeal(DECISION, GROUNDS, KEY)).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
  });

  it('zgłaszający: limiter → walidacja → RPC service_role ze znormalizowanym numerem i kodem', async () => {
    const result = await submitReportAppeal({
      caseNumber: 'dsa-1a2b-3c4d-5e6f-7a8b',
      accessCode: CODE.toLowerCase(),
      grounds: GROUNDS,
      idempotencyKey: KEY,
    });
    expect(result).toMatchObject({ ok: true, reference: 'APL-6C1D-9B2F-4A8B' });
    expect(mocks.adminRpc).toHaveBeenCalledWith('submit_report_appeal', {
      p_case_number: 'DSA-1A2B-3C4D-5E6F-7A8B',
      p_access_code: CODE,
      p_idempotency_key: KEY,
      p_grounds: GROUNDS,
    });
    mocks.rateLimit.mockResolvedValueOnce(false);
    mocks.adminRpc.mockClear();
    expect(
      await submitReportAppeal({ caseNumber: 'DSA-1A2B-3C4D-5E6F-7A8B', accessCode: CODE, grounds: GROUNDS, idempotencyKey: KEY }),
    ).toEqual({ ok: false, error: 'RATE_LIMITED' });
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it('rozpatrzenie: REVIEWER_CONFLICT i STALE_STATE; nowe ograniczenie tylko dla zgłaszającego', async () => {
    mocks.sessionRpc.mockResolvedValueOnce({ data: APPEAL, error: null });
    expect(await decideAppeal(APPEAL, 'pending', 'author', 'job', {
      outcome: 'reversed', reasoning: REASONING, decision: 'job_removed', groundType: 'terms', groundReference: '§ 4',
    })).toEqual({ ok: true });
    expect(mocks.sessionRpc).toHaveBeenLastCalledWith('admin_decide_appeal', expect.objectContaining({
      p_outcome: 'reversed', p_new_decision: null, p_ground_type: null, p_ground_reference: null,
    }));

    mocks.sessionRpc.mockResolvedValueOnce({ data: APPEAL, error: null });
    await decideAppeal(APPEAL, 'pending', 'reporter', 'job', {
      outcome: 'reversed', reasoning: REASONING, decision: 'job_removed', groundType: 'law', groundReference: 'Art. 7',
    });
    expect(mocks.sessionRpc).toHaveBeenLastCalledWith('admin_decide_appeal', expect.objectContaining({
      p_new_decision: 'job_removed', p_ground_type: 'law', p_ground_reference: 'Art. 7',
    }));

    mocks.sessionRpc.mockResolvedValueOnce({ data: null, error: { message: 'REVIEWER_CONFLICT: inny administrator' } });
    expect(await decideAppeal(APPEAL, 'pending', 'author', 'job', { outcome: 'upheld', reasoning: REASONING }))
      .toEqual({ ok: false, error: 'REVIEWER_CONFLICT' });
    mocks.sessionRpc.mockResolvedValueOnce({ data: null, error: { message: 'STALE_STATE: status odwołania zmienił się' } });
    expect(await decideAppeal(APPEAL, 'pending', 'author', 'job', { outcome: 'upheld', reasoning: REASONING }))
      .toEqual({ ok: false, error: 'STALE_STATE' });
    expect(await decideAppeal(APPEAL, 'upheld', 'author', 'job', { outcome: 'upheld', reasoning: REASONING }))
      .toEqual({ ok: false, error: 'VALIDATION_FAILED' });
  });
});

describe('e-maile odwołań', () => {
  it.each(LOCALES)('%s: przyjęcie, utrzymanie i uwzględnienie — w języku odbiorcy, bez tokenów', async (locale) => {
    const author = { appealReference: 'APL-6C1D-9B2F-4A8B', decisionReference: 'DEC-1A2B-3C4D-5E6F', appellantRole: 'author' };
    const reporter = { appealReference: 'APL-6C1D-9B2F-4A8B', caseNumber: 'DSA-1A2B-3C4D-5E6F-7A8B', appellantRole: 'reporter' };
    for (const [template, payload, path, ref] of [
      ['appealReceived', author, '/employer/firma', 'DEC-1A2B-3C4D-5E6F'],
      ['appealUpheld', { ...author, reasoning: REASONING }, '/employer/firma', 'DEC-1A2B-3C4D-5E6F'],
      ['appealReversed', { ...reporter, reasoning: REASONING }, '/zglos-tresc/sprawa', 'DSA-1A2B-3C4D-5E6F-7A8B'],
    ] as const) {
      const built = buildDeliveryData({ template, locale, payload }, SITE);
      const { subject, html } = await renderEmail(template, built.locale, built.data as never);
      expect(html).toContain(`lang="${locale}"`);
      expect(subject).toContain('APL-6C1D-9B2F-4A8B');
      expect(html).toContain(ref);
      expect(html).toContain(`${SITE}/${locale}${path}`);
      if ('reasoning' in payload) expect(html).toContain(REASONING);
      expect(subject).not.toMatch(/\{\w+\}/);
      expect(html).not.toMatch(/\{\w+\}/);
    }
  });

  it('cel CTA zależy od strony odwołania; tytuły powiadomień', () => {
    expect(emailTargetPath('appealReceived', { appellantRole: 'author' })).toBe('/employer/firma');
    expect(emailTargetPath('appealReceived', { appellantRole: 'reporter' })).toBe('/zglos-tresc/sprawa');
    expect(emailTargetPath('appealUpheld', null)).toBe('/zglos-tresc/sprawa');
    expect(titleKeyForType('system', { kind: 'moderation', decision: 'appeal_upheld' })).toBe('itemModerationAppealUpheld');
    expect(titleKeyForType('system', { kind: 'moderation', decision: 'appeal_reversed' })).toBe('itemModerationAppealReversed');
  });
});

describe('widok sprawy zgłaszającego', () => {
  const base = {
    caseNumber: 'DSA-1A2B-3C4D-5E6F-7A8B',
    status: 'dismissed',
    targetType: 'job',
    category: 'fraud',
    createdAt: '2026-09-20T10:00:00Z',
    outcome: 'no_action',
    events: [],
  };

  it('stan i termin odwołania; odwołanie bez nieznanych statusów', () => {
    const view = parseReportCase({
      ...base,
      appealState: 'OK',
      appealDeadline: '2027-03-22T10:00:00Z',
      appeal: { reference: 'APL-1', status: 'reversed', submittedAt: '2026-09-23T10:00:00Z', reasoning: REASONING },
    });
    expect(view?.appealState).toBe('OK');
    expect(view?.appealDeadline).toBe('2027-03-22T10:00:00Z');
    expect(view?.appeal).toMatchObject({ reference: 'APL-1', status: 'reversed', reasoning: REASONING });
    expect(parseReportCase({ ...base, appeal: { reference: 'APL-1', status: 'hacked', submittedAt: 'x' } })?.appeal).toBeNull();
    expect(parseReportCase({ ...base, appealState: 'DROP TABLE' })?.appealState).toBeNull();
  });
});

describe('raport przejrzystości i eksport', () => {
  it('parsowanie agregatów: brakujące liczby = 0, mediana może być pusta', () => {
    const report = parseTransparencyReport({
      period: { from: '2026-01-01T00:00:00Z', to: '2026-09-25T00:00:00Z' },
      notices: { total: 3, byCategory: { fraud: 2, other: 1 } },
      decisions: { total: 2, medianHoursToDecision: 12.5, automatedDecision: 0 },
      appeals: { total: 1, byStatus: { reversed: 1 }, reversedDecisions: 1, medianHoursToDecision: null },
    });
    expect(report?.notices.byCategory).toEqual({ fraud: 2, other: 1 });
    expect(report?.decisions.medianHoursToDecision).toBe(12.5);
    expect(report?.appeals.medianHoursToDecision).toBeNull();
    expect(report?.restorations).toEqual({ total: 0, viaAppeal: 0, manual: 0 });
    expect(parseTransparencyReport({})).toBeNull();
  });

  it('CSV: nagłówek = stałe kolumny, cudzysłowy, neutralizacja formuł arkusza', () => {
    const row = Object.fromEntries(DSA_EXPORT_COLUMNS.map((c) => [c, null])) as DsaExportRow;
    const csv = toCsv([{ ...row, decision_reference: 'DEC-1', ground_reference: '=HYPERLINK("x")', from_appeal: true }]);
    const [header, line] = csv.split('\r\n');
    expect(header).toBe(DSA_EXPORT_COLUMNS.join(','));
    expect(line).toContain('"DEC-1"');
    expect(line).toContain(`"'=HYPERLINK(""x"")"`);
    expect(line).toContain('"true"');
    // Kolumny eksportu nie obejmują danych osobowych ani faktów.
    expect(DSA_EXPORT_COLUMNS.some((c) => /email|name|facts|reporter|grounds/.test(c))).toBe(false);
  });

  it('okres raportu: domyślnie od 1 stycznia do dziś (Bruksela), zły zakres odrzucony', () => {
    const now = new Date('2026-09-24T22:30:00Z'); // w Brukseli już 25 września
    const range = parseDsaReportRange(null, null, now);
    expect(range).toMatchObject({ ok: true, fromYmd: '2026-01-01', toYmd: '2026-09-25' });
    expect(parseDsaReportRange('2026-09-10', '2026-09-01', now).ok).toBe(false);
    expect(parseDsaReportRange('2019-01-01', '2026-09-01', now).ok).toBe(false);
    expect(parseDsaReportRange('2026-02-30', '2026-03-01', now).ok).toBe(false);
  });
});

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
import { ADMIN_PAGE_SIZE } from '@/lib/admin/list-params';
import { parseDsaReportRange } from '@/lib/admin/dsa-report';
import { parseReportCase } from '@/lib/content-reports/case';
import {
  decodeDsaExportCursor,
  DSA_EXPORT_COLUMNS,
  DSA_EXPORT_PAGE_SIZE,
  encodeDsaExportCursor,
  getStatementsExport,
  listAppeals,
  parseTransparencyReport,
  toCsv,
  type DsaExportRow,
} from '@/lib/data/admin-dsa';
import { titleKeyForType } from '@/lib/data/notifications';
import { buildDeliveryData, emailTargetPath } from '@/lib/email/delivery-data';

/**
 * #43 — odwołania od decyzji moderacyjnych: reguły wspólne z formularzami i bazą (0104),
 * akcje wołające jedno RPC z mapowaniem błędów, e-maile w języku odbiorcy bez danych drugiej
 * strony, widok sprawy zgłaszającego, raport przejrzystości i eksport bez danych osobowych.
 */

const mocks = vi.hoisted(() => ({
  rateLimit: vi.fn(async () => true),
}));

vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mocks.rateLimit }));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));
vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());

import { fakeDb, fakeSession, pgError, resetFakeDb } from '../helpers/fake-db';
import { decideAppeal, submitModerationAppeal, submitReportAppeal } from '@/lib/actions/appeals';

const DECISION = '5b0c8a1e-3f7a-4c52-9d1f-2a8e6b7c9d01';
const APPEAL = '6c1d9b2f-4a8b-4d63-8e2a-3b9f7c8d0e12';
const KEY = '0f9a5c3e-1b2d-4e6f-8a7b-9c0d1e2f3a4b';
const CODE = 'ABCDEFGHIJKLMNOPQRSTUVWX';
const GROUNDS = 'Nie pobieramy opłat od kandydatów; to był błąd w szablonie.';
const REASONING = 'Autor wykazał, że opłata nie była pobierana od kandydatów.';
const SITE = 'https://pracuj.be';
const LOCALES: Locale[] = ['pl', 'nl', 'fr', 'en'];
const APPEAL_ROW = { appeal_id: APPEAL, reference: 'APL-6C1D-9B2F-4A8B', created: true };

/** Handler RPC: kolejne wywołania dostają kolejne wyniki (błąd = wyjątek bazy), potem `fallback`. */
function queue(fallback: unknown, ...results: Array<unknown | Error>) {
  return () => {
    const next = results.length ? results.shift() : fallback;
    if (next instanceof Error) throw next;
    return next;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rateLimit.mockResolvedValue(true);
  resetFakeDb({ id: 'u1', role: 'employer' });
  fakeDb.rpc('submit_moderation_appeal', [APPEAL_ROW]).rpc('submit_report_appeal', [APPEAL_ROW]).rpc('admin_decide_appeal', APPEAL);
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
    const [call] = fakeDb.callsTo('submit_moderation_appeal');
    expect(call).toMatchObject({
      kind: 'rpcrows',
      as: 'u1',
      args: { p_decision_id: DECISION, p_idempotency_key: KEY, p_grounds: GROUNDS },
    });
    expect(fakeDb.calls.some((c) => c.as === 'service')).toBe(false);
  });

  it('autor: błędy bazy → kody użytkowe, walidacja przed RPC', async () => {
    fakeDb.rpc('submit_moderation_appeal', queue([APPEAL_ROW],
      pgError('P0001', 'APPEAL_EXISTS'),
      pgError('P0001', 'APPEAL_WINDOW_CLOSED'),
      pgError('P0001', 'VALIDATION_FAILED: GROUNDS_REQUIRED')));
    expect(await submitModerationAppeal(DECISION, GROUNDS, KEY)).toEqual({ ok: false, error: 'APPEAL_EXISTS' });
    expect(await submitModerationAppeal(DECISION, GROUNDS, KEY)).toEqual({ ok: false, error: 'APPEAL_WINDOW_CLOSED' });
    expect(await submitModerationAppeal(DECISION, GROUNDS, KEY)).toMatchObject({ field: 'grounds', fieldError: 'tooShort' });
    const before = fakeDb.calls.length;
    expect(await submitModerationAppeal(DECISION, 'krótko', KEY)).toMatchObject({ field: 'grounds', fieldError: 'tooShort' });
    expect(await submitModerationAppeal(DECISION, GROUNDS, 'nie-uuid')).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(fakeDb.calls.length).toBe(before);
    fakeSession.identity = null;
    expect(await submitModerationAppeal(DECISION, GROUNDS, KEY)).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    expect(fakeDb.calls.length).toBe(before);
  });

  it('autor: wyjątek spoza bazy = INTERNAL; bez bazy = tryb demo bez zapytań', async () => {
    fakeDb.rpc('submit_moderation_appeal', queue([APPEAL_ROW], new Error('ECONNRESET')));
    expect(await submitModerationAppeal(DECISION, GROUNDS, KEY)).toEqual({ ok: false, error: 'INTERNAL' });
    fakeDb.rpc('submit_moderation_appeal', []);
    expect(await submitModerationAppeal(DECISION, GROUNDS, KEY)).toEqual({ ok: false, error: 'INTERNAL' });
    resetFakeDb({ id: 'u1', role: 'employer' });
    fakeSession.configured = false;
    expect(await submitModerationAppeal(DECISION, GROUNDS, KEY)).toMatchObject({ ok: true, demo: true });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('zgłaszający: limiter → walidacja → RPC service_role ze znormalizowanym numerem i kodem', async () => {
    fakeSession.identity = null;
    const result = await submitReportAppeal({
      caseNumber: 'dsa-1a2b-3c4d-5e6f-7a8b',
      accessCode: CODE.toLowerCase(),
      grounds: GROUNDS,
      idempotencyKey: KEY,
    });
    expect(result).toMatchObject({ ok: true, reference: 'APL-6C1D-9B2F-4A8B' });
    expect(fakeDb.callsTo('submit_report_appeal')).toEqual([
      expect.objectContaining({
        as: 'service',
        args: {
          p_case_number: 'DSA-1A2B-3C4D-5E6F-7A8B',
          p_access_code: CODE,
          p_idempotency_key: KEY,
          p_grounds: GROUNDS,
        },
      }),
    ]);
    mocks.rateLimit.mockResolvedValueOnce(false);
    expect(
      await submitReportAppeal({ caseNumber: 'DSA-1A2B-3C4D-5E6F-7A8B', accessCode: CODE, grounds: GROUNDS, idempotencyKey: KEY }),
    ).toEqual({ ok: false, error: 'RATE_LIMITED' });
    expect(fakeDb.callsTo('submit_report_appeal')).toHaveLength(1);

    fakeDb.rpc('submit_report_appeal', queue([APPEAL_ROW], pgError('P0001', 'NOT_FOUND')));
    expect(
      await submitReportAppeal({ caseNumber: 'DSA-1A2B-3C4D-5E6F-7A8B', accessCode: CODE, grounds: GROUNDS, idempotencyKey: KEY }),
    ).toEqual({ ok: false, error: 'NOT_FOUND' });

    fakeSession.serviceConfigured = false;
    expect(
      await submitReportAppeal({ caseNumber: 'DSA-1A2B-3C4D-5E6F-7A8B', accessCode: CODE, grounds: GROUNDS, idempotencyKey: KEY }),
    ).toEqual({ ok: false, error: 'DEMO_UNAVAILABLE' });
  });

  it('rozpatrzenie: REVIEWER_CONFLICT i STALE_STATE; nowe ograniczenie tylko dla zgłaszającego', async () => {
    resetFakeDb({ id: 'admin-1', role: 'admin' });
    fakeDb.rpc('admin_decide_appeal', queue(APPEAL,
      APPEAL,
      APPEAL,
      pgError('P0001', 'REVIEWER_CONFLICT: inny administrator'),
      pgError('P0001', 'STALE_STATE: status odwołania zmienił się'),
      pgError('P0001', 'VALIDATION_FAILED: GROUND_REFERENCE_REQUIRED')));
    expect(await decideAppeal(APPEAL, 'pending', 'author', 'job', {
      outcome: 'reversed', reasoning: REASONING, decision: 'job_removed', groundType: 'terms', groundReference: '§ 4',
    })).toEqual({ ok: true });
    expect(fakeDb.callsTo('admin_decide_appeal').at(-1)).toMatchObject({
      as: 'admin-1',
      args: { p_outcome: 'reversed', p_new_decision: null, p_ground_type: null, p_ground_reference: null },
    });

    await decideAppeal(APPEAL, 'pending', 'reporter', 'job', {
      outcome: 'reversed', reasoning: REASONING, decision: 'job_removed', groundType: 'law', groundReference: 'Art. 7',
    });
    expect(fakeDb.callsTo('admin_decide_appeal').at(-1)?.args).toMatchObject({
      p_new_decision: 'job_removed', p_ground_type: 'law', p_ground_reference: 'Art. 7',
    });

    expect(await decideAppeal(APPEAL, 'pending', 'author', 'job', { outcome: 'upheld', reasoning: REASONING }))
      .toEqual({ ok: false, error: 'REVIEWER_CONFLICT' });
    expect(await decideAppeal(APPEAL, 'pending', 'author', 'job', { outcome: 'upheld', reasoning: REASONING }))
      .toEqual({ ok: false, error: 'STALE_STATE' });
    expect(await decideAppeal(APPEAL, 'pending', 'reporter', 'job', {
      outcome: 'reversed', reasoning: REASONING, decision: 'job_removed', groundType: 'law', groundReference: 'Art. 7',
    })).toMatchObject({ ok: false, error: 'VALIDATION_FAILED', field: 'groundReference' });
    const count = fakeDb.callsTo('admin_decide_appeal').length;
    expect(await decideAppeal(APPEAL, 'upheld', 'author', 'job', { outcome: 'upheld', reasoning: REASONING }))
      .toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    fakeSession.identity = null;
    expect(await decideAppeal(APPEAL, 'pending', 'author', 'job', { outcome: 'upheld', reasoning: REASONING }))
      .toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    expect(fakeDb.callsTo('admin_decide_appeal')).toHaveLength(count);
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

/** Wiersz oczekującego odwołania (kolejka `moderation_appeals`, `APPEAL_SELECT`). */
function pendingAppealRow(index: number) {
  const hex = String(index).padStart(12, '0');
  return {
    id: `aaaaaaaa-aaaa-4aaa-8aaa-${hex}`,
    reference: `APL-${index}`,
    status: 'pending',
    appellant_role: 'author',
    submitted_at: '2026-09-01T00:00:00Z',
    due_at: `2026-09-01T00:00:${String(index).padStart(2, '0')}Z`,
    decided_at: null,
    grounds: 'Uzasadnienie',
    outcome_reasoning: null,
    same_reviewer: null,
    decision: {
      id: 'dec-1', reference: 'DEC-1', decision: 'no_action', facts: null,
      ground_type: null, ground_reference: null, decided_at: '2026-09-01T00:00:00Z', decided_by: null,
    },
    report: { id: 'rep-1', case_number: 'DSA-1', target_type: 'job', category: null },
    restoration: null,
  };
}

describe('kolejka odwołań: stronicowanie kursorem (#596)', () => {
  beforeEach(() => {
    resetFakeDb({ id: 'admin-1', role: 'admin' });
  });

  it('nie ukrywa oczekujących spraw po pierwszych 100 — strona 1 ma 50 i kursor, strona 2 resztę bez kursora', async () => {
    const rows = Array.from({ length: ADMIN_PAGE_SIZE + 1 }, (_, i) => pendingAppealRow(i));
    fakeDb
      .rows('admin-dsa.appeals-pending', ({ values }) => (values.length === 1 ? rows : rows.slice(ADMIN_PAGE_SIZE)))
      .rows('admin-dsa.appeals-decided', [])
      .count('admin-dsa.other-admins', 0);

    const page1 = await listAppeals();
    expect(page1.status).toBe('ok');
    if (page1.status !== 'ok') return;
    expect(page1.pending).toHaveLength(ADMIN_PAGE_SIZE);
    expect(page1.pending[0]?.reference).toBe('APL-0');
    expect(page1.pending.at(-1)?.reference).toBe(`APL-${ADMIN_PAGE_SIZE - 1}`);
    expect(page1.pendingNextCursor).not.toBeNull();
    expect(fakeDb.callsTo('admin-dsa.appeals-pending')[0]?.values).toEqual([ADMIN_PAGE_SIZE + 1]);

    const page2 = await listAppeals({ cursor: page1.pendingNextCursor });
    expect(page2.status).toBe('ok');
    if (page2.status !== 'ok') return;
    expect(page2.pending).toHaveLength(1);
    expect(page2.pending[0]?.reference).toBe(`APL-${ADMIN_PAGE_SIZE}`);
    expect(page2.pendingNextCursor).toBeNull();
    const last = pendingAppealRow(ADMIN_PAGE_SIZE - 1);
    expect(fakeDb.callsTo('admin-dsa.appeals-pending')[1]?.values).toEqual([
      last.due_at, last.id, ADMIN_PAGE_SIZE + 1,
    ]);
  });

  it('kontrola ujemna: kursor spoza tej listy (zły/zniekształcony token) = pierwsza strona, nie błąd', async () => {
    fakeDb.rows('admin-dsa.appeals-pending', []).rows('admin-dsa.appeals-decided', []).count('admin-dsa.other-admins', 0);
    const result = await listAppeals({ cursor: 'to-nie-jest-poprawny-kursor' });
    expect(result.status).toBe('ok');
    // Brak warunku kursora w zapytaniu — tylko limit, jak przy pierwszej stronie.
    expect(fakeDb.callsTo('admin-dsa.appeals-pending')[0]?.values).toEqual([ADMIN_PAGE_SIZE + 1]);
  });
});

/** Wiersz eksportu decyzji DSA (kolumny `DSA_EXPORT_COLUMNS`). */
function exportRow(index: number) {
  return {
    decision_reference: `DEC-${index}`,
    decided_at: `2026-09-01T00:00:${String(index % 60).padStart(2, '0')}Z`,
    decision: 'no_action',
    content_type: 'job',
    notice_category: 'fraud',
    notice_received_at: '2026-09-01T00:00:00Z',
    ground_type: null,
    ground_reference: null,
    automated_detection: false,
    automated_decision: false,
    from_appeal: false,
    appeal_status: null,
    restored: false,
  };
}

describe('eksport decyzji DSA: stronicowanie zamiast całego zakresu naraz (#606)', () => {
  beforeEach(() => {
    resetFakeDb({ id: 'admin-1', role: 'admin' });
  });

  it('pełna strona ⇒ kursor do kolejnej; pusta reszta ⇒ koniec, z limitem i kursorem w wywołaniu RPC', async () => {
    const rows = Array.from({ length: DSA_EXPORT_PAGE_SIZE }, (_, i) => exportRow(i));
    fakeDb.rpc('dsa_statements_export', ({ args }: { args: Record<string, unknown> }) =>
      args['p_cursor_decided_at'] ? [] : rows);
    const from = new Date('2026-01-01T00:00:00Z');
    const to = new Date('2026-12-31T00:00:00Z');

    const page1 = await getStatementsExport(from, to);
    expect(page1.status).toBe('ok');
    if (page1.status !== 'ok') return;
    expect(page1.rows).toHaveLength(DSA_EXPORT_PAGE_SIZE);
    expect(page1.nextCursor).not.toBeNull();
    expect(fakeDb.callsTo('dsa_statements_export')[0]?.args).toMatchObject({
      p_limit: DSA_EXPORT_PAGE_SIZE, p_cursor_decided_at: null, p_cursor_reference: null,
    });

    const page2 = await getStatementsExport(from, to, page1.nextCursor);
    expect(page2.status).toBe('ok');
    if (page2.status !== 'ok') return;
    expect(page2.rows).toHaveLength(0);
    expect(page2.nextCursor).toBeNull();
    const last = rows.at(-1)!;
    expect(fakeDb.callsTo('dsa_statements_export')[1]?.args).toMatchObject({
      p_cursor_decided_at: last.decided_at, p_cursor_reference: last.decision_reference,
    });
  });

  it('kursor: round-trip nieprzezroczystego tokenu; kontrola ujemna zniekształconego wejścia', () => {
    const token = encodeDsaExportCursor('2026-09-20T10:00:00.000Z', 'DEC-ABCD-1234');
    expect(decodeDsaExportCursor(token)).toEqual({ decidedAt: '2026-09-20T10:00:00.000Z', reference: 'DEC-ABCD-1234' });
    expect(decodeDsaExportCursor(null)).toBeNull();
    expect(decodeDsaExportCursor('!!! nie base64url ###')).toBeNull();
    // Token bez separatora `|` (np. spreparowany ręcznie) — odrzucony, nie zgłasza wyjątku.
    expect(decodeDsaExportCursor(Buffer.from('brak-separatora', 'utf8').toString('base64url'))).toBeNull();
  });
});

describe('odwołanie zgłaszającego od cofnięcia ograniczenia (0109)', () => {
  beforeEach(() => {
    resetFakeDb(null);
    fakeSession.identity = null;
    mocks.rateLimit.mockResolvedValue(true);
  });

  it('target=restoration → osobne RPC service_role; domyślnie wynik sprawy (kontrola ujemna)', async () => {
    fakeDb.rpc('submit_report_restoration_appeal', [APPEAL_ROW]).rpc('submit_report_appeal', [APPEAL_ROW]);
    const input = { caseNumber: 'DSA-1A2B-3C4D-5E6F-7A8B', accessCode: CODE, grounds: GROUNDS, idempotencyKey: KEY };
    expect(await submitReportAppeal({ ...input, target: 'restoration' })).toMatchObject({ ok: true });
    expect(fakeDb.callsTo('submit_report_restoration_appeal')).toEqual([
      expect.objectContaining({
        as: 'service',
        args: { p_case_number: input.caseNumber, p_access_code: CODE, p_idempotency_key: KEY, p_grounds: GROUNDS },
      }),
    ]);
    expect(fakeDb.callsTo('submit_report_appeal')).toHaveLength(0);

    await submitReportAppeal(input);
    expect(fakeDb.callsTo('submit_report_appeal')).toHaveLength(1);
    expect(fakeDb.callsTo('submit_report_restoration_appeal')).toHaveLength(1);

    expect(await submitReportAppeal({ ...input, target: 'other' as never })).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
  });

  it('błędy bazy → kody użytkowe (termin, istniejące odwołanie, brak drogi)', async () => {
    const input = { caseNumber: 'DSA-1A2B-3C4D-5E6F-7A8B', accessCode: CODE, grounds: GROUNDS, idempotencyKey: KEY, target: 'restoration' as const };
    for (const [message, code] of [
      ['APPEAL_WINDOW_CLOSED', 'APPEAL_WINDOW_CLOSED'],
      ['APPEAL_EXISTS', 'APPEAL_EXISTS'],
      ['INVALID_TRANSITION', 'INVALID_TRANSITION'],
    ] as const) {
      fakeDb.rpc('submit_report_restoration_appeal', () => {
        throw pgError('P0001', message);
      });
      expect(await submitReportAppeal(input)).toEqual({ ok: false, error: code });
    }
  });

  it('widok sprawy: cofnięcie z drogą odwołania; nieznany stan nie otwiera formularza', () => {
    const base = {
      caseNumber: 'DSA-1A2B-3C4D-5E6F-7A8B',
      status: 'resolved',
      targetType: 'job',
      category: 'fraud',
      createdAt: '2026-09-20T10:00:00Z',
      outcome: 'action_taken',
      events: [],
    };
    const view = parseReportCase({
      ...base,
      restoration: {
        restoredAt: '2026-09-23T10:00:00Z',
        appealState: 'OK',
        appealDeadline: '2027-03-23T10:00:00Z',
        appeal: { reference: 'APL-2', status: 'pending', submittedAt: '2026-09-24T10:00:00Z', dueAt: '2026-10-08T10:00:00Z' },
      },
    });
    expect(view?.restoration).toMatchObject({
      restoredAt: '2026-09-23T10:00:00Z',
      appealState: 'OK',
      appealDeadline: '2027-03-23T10:00:00Z',
      appeal: { reference: 'APL-2', status: 'pending' },
    });
    expect(parseReportCase({ ...base, restoration: { restoredAt: 'x', appealState: 'HACK' } })?.restoration?.appealState).toBeNull();
    expect(parseReportCase({ ...base, restoration: { appealState: 'OK' } })?.restoration).toBeNull();
    expect(parseReportCase(base)?.restoration).toBeNull();
  });

  it.each(LOCALES)('%s: e-mail o cofnięciu — do strony sprawy, bez powodu i danych autora', async (locale) => {
    const payload = { caseNumber: 'DSA-1A2B-3C4D-5E6F-7A8B', recipientName: 'Ra' };
    const built = buildDeliveryData({ template: 'reportRestored', locale, payload }, SITE);
    const { subject, html } = await renderEmail('reportRestored', built.locale, built.data as never);
    expect(html).toContain(`lang="${locale}"`);
    expect(subject).toContain('DSA-1A2B-3C4D-5E6F-7A8B');
    expect(html).toContain(`${SITE}/${locale}/zglos-tresc/sprawa`);
    expect(subject).not.toMatch(/\{\w+\}/);
    expect(html).not.toMatch(/\{\w+\}/);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Locale } from '@/i18n/routing';
import { renderEmail } from '@/emails/templates';
import { decideReport, restoreModeration } from '@/lib/actions/admin';
import {
  decisionsForTarget,
  MODERATION_FACTS_MAX,
  moderationDecisionError,
  moderationFieldFromDbMessage,
  restoreReasonError,
} from '@/lib/admin/moderation';
import { parseReportCase } from '@/lib/content-reports/case';
import { titleKeyForType } from '@/lib/data/notifications';
import { buildDeliveryData } from '@/lib/email/delivery-data';
import { fakeDb, fakeSession, pgError, resetFakeDb } from '../helpers/fake-db';

/**
 * #42 — decyzja moderacyjna w sprawie DSA: reguły wspólne z dialogiem i bazą, akcja woła JEDNO
 * RPC (decyzja + skutek + stan sprawy w transakcji), mapowanie błędów na pola, e-maile w języku
 * odbiorcy (uzasadnienie dla autora, sam wynik dla zgłaszającego), tytuły powiadomień i wynik
 * sprawy w widoku zgłaszającego.
 */

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

const REPORT_ID = '0b9a9c0e-5f4e-4c1a-9d52-6f1f3c1d2e01';
const DECISION_ID = '1c9a9c0e-5f4e-4c1a-9d52-6f1f3c1d2e02';
const FACTS = 'Oferta wymaga od kandydatów opłaty za rekrutację z góry.';
const SITE = 'https://pracuj.be';
const LOCALES: readonly Locale[] = ['pl', 'nl', 'fr', 'en'];

const ADMIN_ID = '00000000-0000-4000-8000-00000000a001';

/**
 * Sesja admina; oba RPC (decyzja, przywrócenie) zwracają uuid albo rzucają błąd bazy.
 * Zwraca listę wywołań RPC (nazwa + argumenty po nazwach) w kolejności.
 */
function mockSession(rpcError?: string) {
  resetFakeDb({ id: ADMIN_ID, role: 'admin' });
  const handler = () => {
    if (rpcError) throw pgError('P0001', rpcError);
    return DECISION_ID;
  };
  fakeDb.rpc('admin_decide_report', handler).rpc('admin_restore_moderation', handler);
  return () =>
    fakeDb.calls
      .filter((c) => c.kind === 'rpc' || c.kind === 'rpcrows')
      .map((c) => [c.name, c.args, c.as] as const);
}

beforeEach(() => {
  vi.resetAllMocks();
  resetFakeDb({ id: ADMIN_ID, role: 'admin' });
});

describe('#42 reguły decyzji (dialog, akcja i baza)', () => {
  it('zgłoszenie firmy nie pozwala wycofać pojedynczej oferty', () => {
    expect(decisionsForTarget('job')).toEqual(['no_action', 'job_removed', 'company_suspended']);
    expect(decisionsForTarget('company')).toEqual(['no_action', 'company_suspended']);
    expect(
      moderationDecisionError({ decision: 'job_removed', facts: FACTS, groundType: 'terms', groundReference: '§ 4' }, 'company'),
    ).toEqual({ field: 'decision', error: 'scope' });
  });

  it('fakty wymagane zawsze; podstawa i jej wskazanie tylko przy ograniczeniu', () => {
    expect(moderationDecisionError({ decision: '', facts: FACTS }, 'job')).toEqual({ field: 'decision', error: 'required' });
    expect(moderationDecisionError({ decision: 'no_action', facts: '' }, 'job')).toEqual({ field: 'facts', error: 'required' });
    expect(moderationDecisionError({ decision: 'no_action', facts: 'za krótko' }, 'job')).toEqual({ field: 'facts', error: 'tooShort' });
    expect(
      moderationDecisionError({ decision: 'no_action', facts: 'x'.repeat(MODERATION_FACTS_MAX + 1) }, 'job'),
    ).toEqual({ field: 'facts', error: 'tooLong' });
    expect(moderationDecisionError({ decision: 'no_action', facts: FACTS }, 'job')).toBeNull();
    expect(moderationDecisionError({ decision: 'job_removed', facts: FACTS }, 'job')).toEqual({ field: 'groundType', error: 'required' });
    expect(
      moderationDecisionError({ decision: 'job_removed', facts: FACTS, groundType: 'terms', groundReference: ' ' }, 'job'),
    ).toEqual({ field: 'groundReference', error: 'required' });
    expect(
      moderationDecisionError({ decision: 'company_suspended', facts: FACTS, groundType: 'law', groundReference: 'Art. 1' }, 'job'),
    ).toBeNull();
  });

  it('powód cofnięcia: 20–1000 znaków', () => {
    expect(restoreReasonError('')).toBe('required');
    expect(restoreReasonError('krótko')).toBe('tooShort');
    expect(restoreReasonError('Autor usunął wymóg opłaty z oferty.')).toBeNull();
  });

  it('komunikaty RPC → pole formularza', () => {
    expect(moderationFieldFromDbMessage('VALIDATION_FAILED: GROUND_REFERENCE_REQUIRED')).toEqual({
      field: 'groundReference',
      error: 'required',
    });
    expect(moderationFieldFromDbMessage('VALIDATION_FAILED: GROUND_REQUIRED')).toEqual({ field: 'groundType', error: 'required' });
    expect(moderationFieldFromDbMessage('VALIDATION_FAILED: FACTS_TOO_LONG')).toEqual({ field: 'facts', error: 'tooLong' });
    expect(moderationFieldFromDbMessage('VALIDATION_FAILED: DECISION')).toBeNull();
  });
});

describe('#42 decideReport / restoreModeration', () => {
  it('jedno RPC z decyzją, faktami, podstawą i statusem widzianym przez admina', async () => {
    const rpc = mockSession();
    const res = await decideReport(REPORT_ID, 'reviewing', 'job', {
      decision: 'job_removed',
      facts: `  ${FACTS}  `,
      groundType: 'terms',
      groundReference: ' Regulamin § 4 ',
      automatedDetection: true,
    });
    expect(res).toEqual({ ok: true });
    expect(rpc()).toHaveLength(1);
    expect(rpc()[0]?.[2]).toBe(ADMIN_ID); // pod sesją admina, nie service_role
    expect(rpc()[0]?.slice(0, 2)).toEqual(['admin_decide_report', {
      p_report_id: REPORT_ID,
      p_expected_status: 'reviewing',
      p_decision: 'job_removed',
      p_facts: FACTS,
      p_ground_type: 'terms',
      p_ground_reference: 'Regulamin § 4',
      p_automated_detection: true,
    }]);
  });

  it('brak działań nie wysyła podstawy', async () => {
    const rpc = mockSession();
    await decideReport(REPORT_ID, 'open', 'job', {
      decision: 'no_action',
      facts: FACTS,
      groundType: 'terms',
      groundReference: '§ 4',
    });
    expect(rpc()[0]?.[1]).toMatchObject({ p_ground_type: null, p_ground_reference: null });
  });

  it('niepoprawne dane → błąd pola bez wywołania bazy', async () => {
    const rpc = mockSession();
    const res = await decideReport(REPORT_ID, 'open', 'job', { decision: 'job_removed', facts: FACTS });
    expect(res).toEqual({ ok: false, error: 'VALIDATION_FAILED', field: 'groundType', fieldError: 'required' });
    expect(rpc()).toHaveLength(0);
    expect(await decideReport('nie-uuid', 'open', 'job', { decision: 'no_action', facts: FACTS })).toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
    });
  });

  it.each([
    ['STALE_STATE: status sprawy zmienił się (resolved)', 'STALE_STATE'],
    ['INVALID_TRANSITION: sprawa rozstrzygnięta', 'INVALID_TRANSITION'],
    ['MODERATION_LOCKED: firma zawieszona decyzją moderacyjną', 'MODERATION_LOCKED'],
    ['PERMISSION_DENIED', 'PERMISSION_DENIED'],
    ['INJECTED_ENFORCEMENT_FAILURE', 'INTERNAL'],
  ])('błąd RPC „%s” → %s (bez szczegółów technicznych)', async (message, code) => {
    mockSession(message);
    const res = await decideReport(REPORT_ID, 'open', 'job', { decision: 'no_action', facts: FACTS });
    expect(res).toEqual({ ok: false, error: code });
  });

  it('błąd walidacji z bazy wraca przy polu', async () => {
    mockSession('VALIDATION_FAILED: GROUND_REFERENCE_TOO_LONG');
    const res = await decideReport(REPORT_ID, 'open', 'job', {
      decision: 'job_removed',
      facts: FACTS,
      groundType: 'law',
      groundReference: 'Art. 1',
    });
    expect(res).toEqual({ ok: false, error: 'VALIDATION_FAILED', field: 'groundReference', fieldError: 'tooLong' });
  });

  it('cofnięcie ograniczenia: RPC z powodem; krótki powód odrzucony lokalnie', async () => {
    const rpc = mockSession();
    expect(await restoreModeration(DECISION_ID, 'krótko')).toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
      field: 'reason',
      fieldError: 'tooShort',
    });
    expect(rpc()).toHaveLength(0);
    expect(await restoreModeration(DECISION_ID, ' Autor usunął wymóg opłaty z oferty. ')).toEqual({ ok: true });
    expect(rpc()).toEqual([
      ['admin_restore_moderation', { p_decision_id: DECISION_ID, p_reason: 'Autor usunął wymóg opłaty z oferty.' }, ADMIN_ID],
    ]);
  });

  it('bez sesji → PERMISSION_DENIED bez wywołania RPC', async () => {
    const rpc = mockSession();
    fakeSession.identity = null;
    expect(await decideReport(REPORT_ID, 'open', 'job', { decision: 'no_action', facts: FACTS })).toEqual({
      ok: false,
      error: 'PERMISSION_DENIED',
    });
    expect(rpc()).toHaveLength(0);
  });

  it('bez backendu → demo, bez zapisu', async () => {
    fakeSession.configured = false;
    expect(await decideReport(REPORT_ID, 'open', 'job', { decision: 'no_action', facts: FACTS })).toEqual({
      ok: true,
      demo: true,
    });
    expect(fakeDb.calls).toHaveLength(0);
  });
});

describe('#42 e-maile w języku odbiorcy', () => {
  const moderationPayload = {
    companyName: 'Firma A',
    jobTitle: 'Magazynier',
    facts: FACTS,
    groundType: 'law',
    groundReference: 'Art. 7 ust. 1',
    automatedDetection: true,
    decisionReference: 'DEC-1A2B-3C4D-5E6F',
  };
  const GROUND_LAW: Record<Locale, string> = {
    pl: 'Przepis prawa',
    nl: 'Wettelijke bepaling',
    fr: 'Disposition légale',
    en: 'Legal provision',
  };

  it.each(LOCALES)('%s: uzasadnienie dla autora (fakty, podstawa, automatyzacja, numer)', async (locale) => {
    for (const template of ['moderationJobRemoved', 'moderationCompanySuspended'] as const) {
      const built = buildDeliveryData({ template, locale, payload: moderationPayload }, SITE, 'Ewa');
      const { subject, html } = await renderEmail(template, built.locale, built.data as never);
      expect(html).toContain(`lang="${locale}"`);
      expect(html).toContain(FACTS);
      expect(html).toContain('Art. 7 ust. 1');
      expect(html).toContain(GROUND_LAW[locale]);
      expect(html).toContain('DEC-1A2B-3C4D-5E6F');
      expect(html).toContain(`${SITE}/${locale}/employer/firma`);
      expect(subject).not.toMatch(/\{\w+\}/);
      expect(html).not.toMatch(/\{\w+\}/);
    }
  });

  it.each(LOCALES)('%s: cofnięcie ograniczenia z powodem', async (locale) => {
    const built = buildDeliveryData(
      {
        template: 'moderationRestored',
        locale,
        payload: { companyName: 'Firma A', reason: 'Autor usunął wymóg opłaty.', decisionReference: 'DEC-1A2B-3C4D-5E6F' },
      },
      SITE,
    );
    const { subject, html } = await renderEmail('moderationRestored', built.locale, built.data as never);
    expect(html).toContain('Autor usunął wymóg opłaty.');
    expect(subject).toContain('DEC-1A2B-3C4D-5E6F');
    expect(html).not.toMatch(/\{\w+\}/);
  });

  it.each(LOCALES)('%s: zgłaszający dostaje sam wynik — bez faktów i danych autora', async (locale) => {
    for (const template of ['reportDecisionActioned', 'reportDecisionNoAction'] as const) {
      const built = buildDeliveryData(
        { template, locale, payload: { caseNumber: 'DSA-1A2B-3C4D-5E6F-7A8B', targetType: 'job' } },
        SITE,
      );
      const { subject, html } = await renderEmail(template, built.locale, built.data as never);
      expect(subject).toContain('DSA-1A2B-3C4D-5E6F-7A8B');
      expect(html).toContain(`${SITE}/${locale}/zglos-tresc/sprawa`);
      expect(html).not.toContain(FACTS);
      expect(html).not.toMatch(/\{\w+\}/);
    }
  });
});

describe('#42 powiadomienia i widok sprawy', () => {
  it('tytuł powiadomienia wg decyzji', () => {
    expect(titleKeyForType('system', { kind: 'moderation', decision: 'job_removed' }, 'company')).toBe(
      'itemModerationJobRemoved',
    );
    expect(titleKeyForType('system', { kind: 'moderation', decision: 'company_suspended' }, 'company')).toBe(
      'itemModerationCompanySuspended',
    );
    expect(titleKeyForType('system', { kind: 'moderation', decision: 'restored' }, 'company')).toBe(
      'itemModerationRestored',
    );
    expect(titleKeyForType('system', { kind: 'moderation', decision: '???' }, 'company')).toBe('itemSystem');
  });

  it('wynik sprawy dla zgłaszającego: znany albo pominięty', () => {
    const base = {
      caseNumber: 'DSA-1',
      status: 'resolved',
      targetType: 'job',
      category: 'fraud',
      createdAt: '2026-09-20T10:00:00.000Z',
      events: [],
    };
    expect(parseReportCase({ ...base, outcome: 'action_taken' })?.outcome).toBe('action_taken');
    expect(parseReportCase({ ...base, outcome: 'no_action' })?.outcome).toBe('no_action');
    expect(parseReportCase({ ...base, outcome: 'surowy_kod' })?.outcome).toBeNull();
    expect(parseReportCase(base)?.outcome).toBeNull();
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createBreachIncident, notifyBreachSubjects, updateBreachIncident } from '@/lib/actions/breaches';
import {
  BREACH_AUTHORITY_DECISIONS,
  BREACH_DATA_CATEGORIES,
  BREACH_KINDS,
  BREACH_LIMITS,
  BREACH_RISK_LEVELS,
  BREACH_SUBJECTS_DECISIONS,
  breachDeadline,
  breachExportCsv,
  breachFieldFromDbMessage,
  breachFieldOfColumn,
  breachFormErrors,
  csvCell,
  emptyBreachForm,
  parseBreachRecipients,
  type BreachForm,
} from '@/lib/admin/breach';
import { AUDIT_ACTION_KEY, AUDIT_ENTITY_TYPES } from '@/lib/admin/list-params';
import { appLocalInputToUtc, utcToAppLocalInput } from '@/lib/datetime';
import { renderEmail } from '@/emails/templates';
import { buildDeliveryData } from '@/lib/email/delivery-data';
import { isSupabaseConfigured } from '@/lib/env';
import { createServerClient } from '@/lib/supabase/server';

/**
 * #490 — rejestr incydentów i naruszeń danych osobowych: kontrakt z migracją 0106, reguły
 * formularza (lustro `breach_incident_validate`), termin 72 h od stwierdzenia, eksport CSV,
 * Server Actions (walidacja przed RPC, błędy pól z bazy) i szablon zawiadomienia w języku
 * odbiorcy.
 */

vi.mock('@/lib/env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/env')>()),
  isSupabaseConfigured: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }));
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));

const MIGRATION = readFileSync(resolve(process.cwd(), 'supabase/migrations/0106_breach_register.sql'), 'utf8');
const NOW = Date.parse('2026-09-24T12:00:00.000Z');
const KEY = '5a0e8f4c-2b1d-4c3e-9f7a-1d2e3f4a5b6c';
const ID = '6b1f9a5d-3c2e-4d4f-8a8b-2e3f4a5b6c7d';

function listFromCheck(constraint: string): string[] {
  const block = MIGRATION.match(new RegExp(`constraint ${constraint} check \\(([\\s\\S]*?)\\)\\)?,\\n`))?.[1] ?? '';
  return [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
}

function validForm(overrides: Partial<BreachForm> = {}): BreachForm {
  return {
    ...emptyBreachForm(),
    title: 'Błędny adresat',
    description: 'Powiadomienie trafiło do niewłaściwej osoby.',
    detectedAt: '2026-09-24T10:00:00.000Z',
    ...overrides,
  };
}

function mockSession(rpcResult: { data?: unknown; error?: { message: string } | null }) {
  const rpc = vi.fn().mockResolvedValue({ data: rpcResult.data ?? null, error: rpcResult.error ?? null });
  vi.mocked(createServerClient).mockResolvedValue({
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'admin-1' } } }) },
    rpc,
  } as never);
  return rpc;
}

beforeEach(() => {
  vi.mocked(isSupabaseConfigured).mockReturnValue(true);
  vi.mocked(createServerClient).mockReset();
});

describe('#490 kontrakt z migracją 0106', () => {
  it('listy wartości w TS = CHECK-i w bazie', () => {
    expect(listFromCheck('breach_kind').sort()).toEqual([...BREACH_KINDS].sort());
    expect(listFromCheck('breach_categories').sort()).toEqual([...BREACH_DATA_CATEGORIES].sort());
    expect(listFromCheck('breach_risk_level').sort()).toEqual([...BREACH_RISK_LEVELS].sort());
    expect(listFromCheck('breach_authority_decision').sort()).toEqual([...BREACH_AUTHORITY_DECISIONS].sort());
    expect(listFromCheck('breach_subjects_decision').sort()).toEqual([...BREACH_SUBJECTS_DECISIONS].sort());
  });

  it('limity długości jak w bazie', () => {
    expect(MIGRATION).toContain(`char_length(btrim(title)) between 1 and ${BREACH_LIMITS.title}`);
    expect(MIGRATION).toContain(`char_length(btrim(description)) between 1 and ${BREACH_LIMITS.description}`);
    expect(MIGRATION).toContain(`char_length(closure_summary) <= ${BREACH_LIMITS.closureSummary}`);
    expect(MIGRATION).toContain(`cardinality(p_recipients) > ${BREACH_LIMITS.recipients}`);
    expect(MIGRATION).toContain(`not between 1 and ${BREACH_LIMITS.noticeText}`);
  });

  it('akcje audytu i typ obiektu mają etykiety dziennika', () => {
    expect(AUDIT_ENTITY_TYPES).toContain('breach_incident');
    const actions = [...MIGRATION.matchAll(/write_audit\('(breach\.[a-z_]+)'/g)].map((m) => m[1]!);
    expect(new Set(actions)).toEqual(
      new Set(['breach.created', 'breach.updated', 'breach.closed', 'breach.reopened', 'breach.exported', 'breach.subjects_notified']),
    );
    for (const action of actions) expect(AUDIT_ACTION_KEY[action], action).toBeTruthy();
  });

  it('kolumny historii mapują się na pola formularza', () => {
    const fields = MIGRATION.match(/select array\['kind'[\s\S]*?\]::text\[\]/)?.[0] ?? '';
    for (const column of [...fields.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!)) {
      expect(breachFieldOfColumn(column), column).not.toBeNull();
    }
  });
});

describe('#490 reguły formularza (lustro breach_incident_validate)', () => {
  it('poprawny szkic bez oceny i decyzji przechodzi', () => {
    expect(breachFormErrors(validForm(), NOW)).toEqual({});
  });

  it('pola wymagane, przyszła data i kolejność dat', () => {
    const errors = breachFormErrors(
      validForm({ title: ' ', description: '', detectedAt: '2026-09-25T12:00:00.000Z', occurredAt: '' }),
      NOW,
    );
    expect(errors).toMatchObject({ title: 'required', description: 'required', detectedAt: 'future' });
    expect(breachFormErrors(validForm({ occurredAt: '2026-09-24T11:00:00.000Z' }), NOW).occurredAt).toBe(
      'afterDetected',
    );
    expect(breachFormErrors(validForm({ detectedAt: 'invalid' }), NOW).detectedAt).toBe('invalid');
  });

  it('decyzja wymaga uzasadnienia; ocena ryzyka wymaga opisu', () => {
    const errors = breachFormErrors(validForm({ riskLevel: 'risk', authorityDecision: 'notify' }), NOW);
    expect(errors).toMatchObject({ riskAssessment: 'required', authorityDecisionReason: 'required' });
  });

  it('art. 33/34: decyzja sprzeczna z oceną ryzyka odrzucona', () => {
    const base = { riskAssessment: 'r', authorityDecisionReason: 'x', subjectsDecisionReason: 'x' };
    expect(
      breachFormErrors(validForm({ ...base, riskLevel: 'risk', authorityDecision: 'not_required' }), NOW)
        .authorityDecision,
    ).toBe('conflictsWithRisk');
    expect(
      breachFormErrors(validForm({ ...base, riskLevel: 'high_risk', subjectsDecision: 'not_required' }), NOW)
        .subjectsDecision,
    ).toBe('conflictsWithRisk');
    // Kontrola: przy braku ryzyka „nie zgłaszamy” jest dopuszczalne.
    expect(
      breachFormErrors(validForm({ ...base, riskLevel: 'no_risk', authorityDecision: 'not_required' }), NOW),
    ).toEqual({});
  });

  it('zgłoszenie po 72 h od stwierdzenia wymaga przyczyn opóźnienia; w terminie — nie', () => {
    const base = {
      riskLevel: 'risk',
      riskAssessment: 'r',
      authorityDecision: 'notify',
      authorityDecisionReason: 'x',
      detectedAt: '2026-09-20T12:00:00.000Z',
    };
    expect(
      breachFormErrors(validForm({ ...base, authorityNotifiedAt: '2026-09-23T13:00:00.000Z' }), NOW)
        .authorityDelayReason,
    ).toBe('required');
    expect(
      breachFormErrors(validForm({ ...base, authorityNotifiedAt: '2026-09-23T11:00:00.000Z' }), NOW),
    ).toEqual({});
  });

  it('data zgłoszenia tylko przy decyzji „zgłaszamy”', () => {
    expect(
      breachFormErrors(validForm({ authorityNotifiedAt: '2026-09-24T11:00:00.000Z' }), NOW).authorityNotifiedAt,
    ).toBe('decisionMismatch');
  });

  it('kod pola z komunikatu bazy', () => {
    expect(breachFieldFromDbMessage('VALIDATION_FAILED: authorityDelayReason:required')).toEqual({
      field: 'authorityDelayReason',
      error: 'required',
    });
    expect(breachFieldFromDbMessage('STALE_STATE')).toBeNull();
  });
});

describe('#490 termin 72 h liczony od stwierdzenia', () => {
  const base = {
    kind: 'personal_data_breach',
    detectedAt: '2026-09-23T12:00:00.000Z',
    authorityDecision: 'pending',
    authorityNotifiedAt: null,
    status: 'open',
  };

  it('biegnie, mija, zgłoszenie w terminie i po terminie', () => {
    expect(breachDeadline(base, NOW)).toMatchObject({ state: 'running', hoursLeft: 48 });
    expect(breachDeadline({ ...base, detectedAt: '2026-09-20T12:00:00.000Z' }, NOW)).toMatchObject({
      state: 'overdue',
      hoursOver: 24,
    });
    expect(
      breachDeadline({ ...base, authorityDecision: 'notify', authorityNotifiedAt: '2026-09-24T11:00:00.000Z' }, NOW),
    ).toMatchObject({ state: 'notified', late: false });
    expect(
      breachDeadline(
        { ...base, detectedAt: '2026-09-20T12:00:00.000Z', authorityDecision: 'notify', authorityNotifiedAt: '2026-09-24T11:00:00.000Z' },
        NOW,
      ),
    ).toMatchObject({ state: 'notified', late: true });
  });

  it('incydent bez danych osobowych i decyzja „nie wymaga” — bez terminu', () => {
    expect(breachDeadline({ ...base, kind: 'security_incident' }, NOW).state).toBe('notApplicable');
    expect(breachDeadline({ ...base, authorityDecision: 'not_required' }, NOW).state).toBe('notApplicable');
  });
});

describe('#490 daty w strefie Europe/Brussels', () => {
  it('lato (UTC+2) i zima (UTC+1), w obie strony', () => {
    expect(appLocalInputToUtc('2026-07-01T10:00')).toBe('2026-07-01T08:00:00.000Z');
    expect(appLocalInputToUtc('2026-01-15T10:00')).toBe('2026-01-15T09:00:00.000Z');
    expect(utcToAppLocalInput('2026-07-01T08:00:00.000Z')).toBe('2026-07-01T10:00');
    expect(utcToAppLocalInput('2026-01-15T09:00:00.000Z')).toBe('2026-01-15T10:00');
    expect(appLocalInputToUtc('2026-02-30T10:00')).toBeNull();
    expect(utcToAppLocalInput(null)).toBe('');
  });
});

describe('#490 odbiorcy zawiadomienia i eksport', () => {
  it('lista odbiorców: e-mail lub UUID, bez duplikatów, zły format osobno', () => {
    expect(parseBreachRecipients(`a@test.be\nA@test.be; ${KEY}, bez-malpy\n\n`)).toEqual({
      entries: ['a@test.be', KEY],
      malformed: ['bez-malpy'],
    });
  });

  it('CSV: ochrona przed formułami, cudzysłowy, bez client_key', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('a,b')).toBe('"a,b"');
    const csv = breachExportCsv({
      incident: { reference: 'NAR-2026-ABC', client_key: KEY, title: 'T', data_categories: ['contact', 'cv_files'] },
      events: [{ version: 1, eventType: 'created', createdAt: 'x', actor: null, changes: {}, note: '' }],
      exportedAt: '2026-09-24T12:00:00Z',
    });
    expect(csv.startsWith('﻿field,value\r\n')).toBe(true);
    expect(csv).toContain('reference,NAR-2026-ABC');
    expect(csv).toContain('data_categories,"contact; cv_files"');
    expect(csv).not.toContain(KEY);
    expect(csv).toContain('1,created,x,,{},');
  });
});

describe('#490 Server Actions', () => {
  it('niepoprawny formularz nie woła RPC', async () => {
    const rpc = mockSession({});
    const res = await createBreachIncident(KEY, { ...validForm(), title: '' });
    expect(res).toMatchObject({ ok: false, error: 'VALIDATION_FAILED', fields: { title: 'required' } });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('nowy wpis: jeden RPC z kluczem idempotencji', async () => {
    const rpc = mockSession({ data: ID });
    const res = await createBreachIncident(KEY, validForm());
    expect(res).toEqual({ ok: true, id: ID });
    expect(rpc).toHaveBeenCalledWith('admin_create_breach_incident', {
      p_client_key: KEY,
      p_data: expect.objectContaining({ title: 'Błędny adresat', detectedAt: '2026-09-24T10:00:00.000Z' }),
    });
  });

  it('błąd pola z bazy wraca przy polu; konflikt wersji → STALE_STATE', async () => {
    mockSession({ error: { message: 'VALIDATION_FAILED: detectedAt:future' } });
    expect(await updateBreachIncident(ID, 2, validForm())).toMatchObject({
      ok: false,
      fields: { detectedAt: 'future' },
    });
    mockSession({ error: { message: 'STALE_STATE: wpis zmieniono w międzyczasie' } });
    expect(await updateBreachIncident(ID, 2, validForm())).toMatchObject({ ok: false, error: 'STALE_STATE' });
  });

  it('bez env (DEMO) nic nie zapisuje', async () => {
    vi.mocked(isSupabaseConfigured).mockReturnValue(false);
    expect(await createBreachIncident(KEY, validForm())).toEqual({ ok: true, demo: true });
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it('zawiadomienie: zły format odbiorcy bez RPC; brak języków z bazy → lista braków', async () => {
    const rpc = mockSession({
      data: { status: 'invalid', unknown: [], unknownCount: 0, missingLocales: ['nl'] },
    });
    const bad = await notifyBreachSubjects(ID, KEY, {
      recipients: 'nie-adres',
      content: { pl: { subject: 'a', body: 'b' } },
    });
    expect(bad).toMatchObject({ ok: false, field: 'recipients', malformed: ['nie-adres'] });
    expect(rpc).not.toHaveBeenCalled();

    const res = await notifyBreachSubjects(ID, KEY, {
      recipients: 'a@test.be',
      content: { pl: { subject: ' Temat ', body: 'Treść' }, nl: { subject: '', body: '' }, de: { subject: 'x', body: 'y' } },
    });
    expect(res).toMatchObject({ ok: false, missingLocales: ['nl'] });
    expect(rpc).toHaveBeenCalledWith('admin_notify_breach_subjects', {
      p_id: ID,
      p_client_key: KEY,
      p_recipients: ['a@test.be'],
      p_content: { pl: { subject: 'Temat', body: 'Treść' } },
    });
  });
});

describe('#490 szablon zawiadomienia (Invariant #1)', () => {
  it('temat i treść od administratora w języku odbiorcy; tekst bez interpretacji', async () => {
    const built = buildDeliveryData(
      {
        template: 'breachNotice',
        locale: 'nl',
        payload: {
          noticeSubject: 'Onderwerp NL',
          noticeText: 'Eerste alinea <b>{recipientName}</b>\n\nTweede alinea',
          incidentReference: 'NAR-2026-ABCDEF0123',
          panel: 'employer',
        },
      },
      'https://pracuj.be',
      'Bea',
    );
    expect(built.data['actionUrl']).toBe('https://pracuj.be/nl/employer/ustawienia');
    const { subject, html } = await renderEmail('breachNotice', built.locale, built.data as never);
    expect(subject).toBe('Onderwerp NL');
    expect(html).toContain('Tweede alinea');
    expect(html).toContain('&lt;b&gt;{recipientName}&lt;/b&gt;');
    expect(html).toContain('NAR-2026-ABCDEF0123');
    expect(html).toContain('Naar je accountinstellingen');
    // Kontrola ujemna: kandydat w języku pl dostaje link i przycisk po polsku.
    const pl = buildDeliveryData(
      { template: 'breachNotice', locale: 'pl', payload: { panel: 'candidate' } },
      'https://pracuj.be',
    );
    expect(pl.data['actionUrl']).toBe('https://pracuj.be/pl/candidate/ustawienia');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { applyToJob, transitionApplication } from '@/lib/actions/applications';
import { respondToOffer, sendOffer } from '@/lib/actions/offers';
import { saveOnboardingStep } from '@/lib/actions/onboarding';
import { checkRateLimit } from '@/lib/rate-limit';
import { fakeDb, fakeSession, pgError, resetFakeDb } from '../helpers/fake-db';

/**
 * #350 — cienka warstwa Server Actions przepływu z CLAUDE.md §9 (aplikacja → status →
 * propozycja → odpowiedź → onboarding; wiadomości: messages-actions.test). Logika domenowa jest
 * w DB (rls.sql, PG16: tests/integration/portal-candidate.test.ts);
 * tu pilnujemy granicy: walidacja przed RPC, limit przed RPC, klucz idempotencji przekazany
 * bez zmian (Invariant #3) i błędy Postgresa zamienione na kody użytkowe bez surowego tekstu
 * (Invariant #8).
 */

vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(async () => true) }));
vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));
vi.mock('next-intl/server', () => ({ getLocale: async () => 'nl' }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'user-agent': 'vitest' }) }));

const JOB = '11111111-1111-4111-8111-111111111111';
const KEY = '22222222-2222-4222-8222-222222222222';
const CANDIDATE = '33333333-3333-4333-8333-333333333333';
const OFFER = '44444444-4444-4444-8444-444444444444';
const USER = '66666666-6666-4666-8666-666666666666';

/** Surowe komunikaty Postgresa → oczekiwany kod użytkowy. */
const PG_ERRORS: Array<[string, string]> = [
  ['COMPANY_NOT_VERIFIED: company 7 is pending', 'COMPANY_NOT_VERIFIED'],
  ['JOB_NOT_ACTIVE', 'JOB_NOT_ACTIVE'],
  ['NOT_FOUND: job', 'NOT_FOUND'],
  ['PERMISSION_DENIED', 'PERMISSION_DENIED'],
  ['UNAUTHENTICATED', 'PERMISSION_DENIED'],
  ['new row violates row-level security policy for table "applications"', 'PERMISSION_DENIED'],
  ['duplicate key value violates unique constraint "applications_pkey" (SQLSTATE 23505)', 'INTERNAL'],
];

/** Wynik akcji nie może zawierać żadnego fragmentu surowego komunikatu bazy (Invariant #8). */
function expectNoTechnicalText(result: unknown, pgMessage: string) {
  const serialized = JSON.stringify(result);
  for (const word of ['violates', 'SQLSTATE', 'policy', 'constraint', 'company 7', 'table']) {
    if (pgMessage.includes(word)) expect(serialized).not.toContain(word);
  }
}

const application = { jobId: JOB, agreeTerms: true as const, idempotencyKey: KEY };

const RPCS = [
  'apply_to_job', 'transition_application', 'send_offer', 'respond_to_offer',
  'save_candidate_onboarding_step3', 'save_candidate_onboarding_step5', 'finish_onboarding',
  'record_document_acceptance',
] as const;

/** Wszystkie RPC przepływu zwracają wynik; `fail(name, message)` = błąd bazy (pg: message + SQLSTATE). */
function fail(name: string, message: string) {
  fakeDb.rpc(name, () => { throw pgError('P0001', message); });
}
const rpcCalls = () => fakeDb.calls.filter((call) => call.kind === 'rpc' || call.kind === 'rpcrows');

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkRateLimit).mockResolvedValue(true);
  resetFakeDb({ id: USER, role: 'candidate' });
  for (const name of RPCS) fakeDb.rpc(name, name === 'finish_onboarding' ? true : 'row-1');
  fakeDb.exec('onboarding.step1-profile', 1).exec('onboarding.candidate-profile-upsert', 1);
});

describe('applyToJob', () => {
  it('sukces: RPC apply_to_job dostaje klucz idempotencji klienta bez zmian', async () => {
    expect(await applyToJob(application)).toEqual({ ok: true, id: 'row-1' });
    expect(rpcCalls()).toHaveLength(1);
    expect(fakeDb.callsTo('apply_to_job')[0]).toMatchObject({
      as: USER, args: { p_job_id: JOB, p_idempotency_key: KEY },
    });
  });

  it('ponowienie z tym samym kluczem wysyła do RPC identyczny klucz (Invariant #3)', async () => {
    await applyToJob(application);
    await applyToJob(application);
    const keys = fakeDb.callsTo('apply_to_job').map((call) => call.args['p_idempotency_key']);
    expect(keys).toEqual([KEY, KEY]);
  });

  it('przekroczony limit → RATE_LIMITED, RPC niewołane', async () => {
    vi.mocked(checkRateLimit).mockResolvedValue(false);
    expect(await applyToJob(application)).toEqual({ ok: false, error: 'RATE_LIMITED' });
    expect(checkRateLimit).toHaveBeenCalledWith('apply', expect.any(Object));
    expect(rpcCalls()).toHaveLength(0);
  });

  it.each([
    ['brak zgody na regulamin', { ...application, agreeTerms: false }],
    ['jobId nie-UUID', { ...application, jobId: 'oferta-1' }],
    ['klucz idempotencji nie-UUID', { ...application, idempotencyKey: 'klik-1' }],
  ])('niepoprawne dane (%s) → VALIDATION_FAILED, RPC niewołane', async (_label, input) => {
    expect(await applyToJob(input as never)).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(rpcCalls()).toHaveLength(0);
  });

  // applyToJob odróżnia brak sesji (UNAUTHENTICATED → link logowania w modalu) od PERMISSION_DENIED.
  const APPLY_ERRORS = PG_ERRORS.map(([message, code]): [string, string] =>
    message === 'UNAUTHENTICATED' ? [message, 'UNAUTHENTICATED'] : [message, code],
  );

  it.each(APPLY_ERRORS)('błąd RPC „%s” → %s bez technikaliów', async (message, code) => {
    fail('apply_to_job', message);
    const result = await applyToJob(application);
    expect(result).toEqual({ ok: false, error: code });
    expectNoTechnicalText(result, message);
  });
});

describe('transitionApplication', () => {
  it('sukces: przekazuje identyfikator i status docelowy', async () => {
    expect(await transitionApplication(OFFER, 'shortlisted')).toEqual({ ok: true });
    expect(fakeDb.callsTo('transition_application')[0]!.args).toEqual({
      p_application_id: OFFER,
      p_target: 'shortlisted',
    });
  });

  it.each([
    ['niedozwolone przejście hired → rejected', 'INVALID_TRANSITION'],
    ['status zmienił się równolegle', 'INVALID_TRANSITION'],
    ...PG_ERRORS,
  ])('błąd RPC „%s” → %s', async (message, code) => {
    fail('transition_application', message);
    const result = await transitionApplication(OFFER, 'rejected');
    expect(result).toEqual({ ok: false, error: code });
    expectNoTechnicalText(result, message);
  });
});

describe('sendOffer', () => {
  const offer = { jobId: JOB, candidateId: CANDIDATE, idempotencyKey: KEY };

  it('sukces: klucz idempotencji klienta trafia do send_offer bez zmian, brak treści → NULL', async () => {
    expect(await sendOffer(offer)).toEqual({ ok: true, id: 'row-1' });
    expect(fakeDb.callsTo('send_offer')[0]!.args).toEqual({
      p_job_id: JOB,
      p_candidate_id: CANDIDATE,
      p_idempotency_key: KEY,
      p_message: null,
      p_expires_at: null,
    });
  });

  it('bez klucza idempotencji → VALIDATION_FAILED, RPC niewołane (retry nie może tworzyć nowego klucza)', async () => {
    const { idempotencyKey: _omit, ...withoutKey } = offer;
    expect(await sendOffer(withoutKey as never)).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(rpcCalls()).toHaveLength(0);
  });

  it('za krótka treść → VALIDATION_FAILED, RPC niewołane', async () => {
    expect(await sendOffer({ ...offer, message: 'Hej' })).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(rpcCalls()).toHaveLength(0);
  });

  it.each(PG_ERRORS)('błąd RPC „%s” → %s bez technikaliów', async (message, code) => {
    fail('send_offer', message);
    const result = await sendOffer(offer);
    expect(result).toEqual({ ok: false, error: code });
    expectNoTechnicalText(result, message);
  });
});

describe('respondToOffer', () => {
  it('sukces: akceptacja trafia do respond_to_offer', async () => {
    expect(await respondToOffer(OFFER, true)).toEqual({ ok: true });
    expect(fakeDb.callsTo('respond_to_offer')[0]).toMatchObject({ as: USER, args: { p_offer_id: OFFER, p_accept: true } });
  });

  it.each(['', 'oferta-1', `${OFFER}x`])('identyfikator „%s” → VALIDATION_FAILED bez RPC', async (id) => {
    expect(await respondToOffer(id, false)).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(rpcCalls()).toHaveLength(0);
  });

  it.each(PG_ERRORS.filter(([, code]) => code !== 'COMPANY_NOT_VERIFIED'))(
    'błąd RPC „%s” → %s bez technikaliów',
    async (message, code) => {
      fail('respond_to_offer', message);
      const result = await respondToOffer(OFFER, false);
      expect(result).toEqual({ ok: false, error: code });
      expectNoTechnicalText(result, message);
    },
  );
});

describe('saveOnboardingStep', () => {
  const STEP3 = { skills: ['wózek widłowy'], experienceYears: 3 };
  const STEP5 = {
    languages: [{ language: 'nl', level: 'basic' }],
    certificates: ['VCA', 'ADR'],
    certificateExpiry: { VCA: '2027-01-31' },
  };
  const STEP6 = { availability: 'immediate', preferredContractTypes: ['permanent'], agreeTerms: true };

  it('krok 3: doświadczenie i umiejętności jednym RPC (jedna transakcja, #142)', async () => {
    expect(await saveOnboardingStep(3, STEP3)).toEqual({ ok: true });
    expect(fakeDb.calls).toHaveLength(1);
    expect(fakeDb.callsTo('save_candidate_onboarding_step3')[0]).toMatchObject({
      as: USER, args: { p_experience_years: 3, p_skills: ['wózek widłowy'] },
    });
    // Żadnego osobnego zapisu doświadczenia przed RPC — inaczej błąd RPC zostawiłby część kroku.
  });

  it('krok 5: języki i certyfikaty jednym RPC (jedna transakcja, #142)', async () => {
    expect(await saveOnboardingStep(5, STEP5)).toEqual({ ok: true });
    expect(fakeDb.calls).toHaveLength(1);
    // Data ważności trafia do RPC (#96); certyfikat bez daty = bezterminowy (null). Argumenty
    // jsonb idą jako JSON (nie literał tablicy PG).
    const args = fakeDb.callsTo('save_candidate_onboarding_step5')[0]!.args;
    expect(JSON.parse(args['p_languages'] as string)).toEqual([{ language: 'nl', level: 'basic' }]);
    expect(JSON.parse(args['p_certificates'] as string)).toEqual([
      { label: 'VCA', expires_at: '2027-01-31' },
      { label: 'ADR', expires_at: null },
    ]);
  });

  it('krok 6 z finish: finish_onboarding i receipt zgody', async () => {
    expect(await saveOnboardingStep(6, STEP6, { finish: true })).toEqual({ ok: true });
    expect(fakeDb.callsTo('onboarding.candidate-profile-upsert')[0]!.as).toBe(USER);
    expect(fakeDb.callsTo('finish_onboarding')[0]).toMatchObject({ as: USER, args: {} });
    // Receipt: RPC tylko dla service_role, kluczowane UUID z sesji.
    expect(fakeDb.callsTo('record_document_acceptance')[0]).toMatchObject({
      as: 'service',
      args: { p_profile_id: USER, p_documents: ['terms', 'privacy'], p_locale: 'nl', p_user_agent: 'vitest' },
    });
  });

  it('krok 6 z finish: profil niekompletny w DB → ONBOARDING_INCOMPLETE, bez receiptu', async () => {
    fakeDb.rpc('finish_onboarding', false);
    expect(await saveOnboardingStep(6, STEP6, { finish: true })).toEqual({
      ok: false,
      error: 'ONBOARDING_INCOMPLETE',
    });
    expect(fakeDb.callsTo('record_document_acceptance')).toHaveLength(0);
  });

  it.each([
    [3, STEP3, 'save_candidate_onboarding_step3'],
    [5, STEP5, 'save_candidate_onboarding_step5'],
    [6, STEP6, 'finish_onboarding'],
  ] as const)('krok %s: błąd RPC %s → ok:false (nie sukces)', async (step, data, failing) => {
    fail(failing, 'new row violates row-level security policy');
    const result = await saveOnboardingStep(step, data, { finish: step === 6 });
    expect(result).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    expectNoTechnicalText(result, 'violates policy');
  });

  it('błąd zapisu profilu (krok 1) → ok:false; nieoczekiwany wyjątek → INTERNAL', async () => {
    fakeDb.exec('onboarding.step1-profile', () => { throw pgError('42501', 'permission denied: row-level security'); });
    expect(await saveOnboardingStep(1, { firstName: 'Anna', lastName: 'Nowak' })).toEqual({
      ok: false,
      error: 'PERMISSION_DENIED',
    });
    fakeDb.exec('onboarding.candidate-profile-upsert', () => { throw new Error('socket hang up at 10.0.0.1:5432'); });
    const result = await saveOnboardingStep(2, { occupations: ['magazynier'], categories: ['warehouse'] });
    expect(result).toEqual({ ok: false, error: 'INTERNAL' });
    expect(JSON.stringify(result)).not.toContain('socket');
  });

  it('bez sesji → PERMISSION_DENIED, nic nie jest zapisywane', async () => {
    fakeSession.identity = null;
    expect(await saveOnboardingStep(3, STEP3)).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('niepoprawne dane kroku → VALIDATION_FAILED, nic nie jest zapisywane', async () => {
    expect(await saveOnboardingStep(3, { skills: [], experienceYears: -1 })).toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
    });
    expect(await saveOnboardingStep(6, { ...STEP6, agreeTerms: false }, { finish: true })).toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
    });
    expect(fakeDb.calls).toHaveLength(0);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { applyToJob, transitionApplication } from '@/lib/actions/applications';
import { loadOlderMessages, markConversationRead, openConversation, sendMessage } from '@/lib/actions/messages';
import { getOlderThreadMessages } from '@/lib/data/messages';
import { respondToOffer, sendOffer } from '@/lib/actions/offers';
import { saveOnboardingStep } from '@/lib/actions/onboarding';
import { isSupabaseConfigured } from '@/lib/env';
import { checkRateLimit } from '@/lib/rate-limit';

/**
 * #350 — cienka warstwa Server Actions przepływu z CLAUDE.md §9 (aplikacja → status →
 * propozycja → odpowiedź → wiadomość → onboarding). Logika domenowa jest w DB (rls.sql);
 * tu pilnujemy granicy: walidacja przed RPC, limit przed RPC, klucz idempotencji przekazany
 * bez zmian (Invariant #3) i błędy Postgresa zamienione na kody użytkowe bez surowego tekstu
 * (Invariant #8).
 */

const rpc = vi.fn();
const upsert = vi.fn();
const updateEq = vi.fn();
const from = vi.fn(() => ({ upsert, update: () => ({ eq: updateEq }) }));
const getUser = vi.fn();
const adminRpc = vi.fn();

vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(async () => true) }));
vi.mock('@/lib/env', () => ({ isSupabaseConfigured: vi.fn(() => true) }));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(async () => ({ rpc, from, auth: { getUser } })),
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ rpc: adminRpc }) }));
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));
vi.mock('next-intl/server', () => ({ getLocale: async () => 'nl' }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'user-agent': 'vitest' }) }));
vi.mock('@/lib/data/messages', () => ({ getOlderThreadMessages: vi.fn() }));

const JOB = '11111111-1111-4111-8111-111111111111';
const KEY = '22222222-2222-4222-8222-222222222222';
const CANDIDATE = '33333333-3333-4333-8333-333333333333';
const OFFER = '44444444-4444-4444-8444-444444444444';
const CONVERSATION = '55555555-5555-4555-8555-555555555555';
const CLIENT_MSG = '66666666-6666-4666-8666-666666666666';
const USER = '66666666-6666-4666-8666-666666666666';

/** Surowe komunikaty Postgresa/PostgREST → oczekiwany kod użytkowy. */
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isSupabaseConfigured).mockReturnValue(true);
  vi.mocked(checkRateLimit).mockResolvedValue(true);
  rpc.mockResolvedValue({ data: 'row-1', error: null });
  upsert.mockResolvedValue({ error: null });
  updateEq.mockResolvedValue({ error: null });
  adminRpc.mockResolvedValue({ error: null });
  getUser.mockResolvedValue({ data: { user: { id: USER } } });
});

describe('applyToJob', () => {
  it('sukces: RPC apply_to_job dostaje klucz idempotencji klienta bez zmian', async () => {
    expect(await applyToJob(application)).toEqual({ ok: true, id: 'row-1' });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      'apply_to_job',
      expect.objectContaining({ p_job_id: JOB, p_idempotency_key: KEY }),
    );
  });

  it('ponowienie z tym samym kluczem wysyła do RPC identyczny klucz (Invariant #3)', async () => {
    await applyToJob(application);
    await applyToJob(application);
    const keys = rpc.mock.calls.map((call) => call[1].p_idempotency_key);
    expect(keys).toEqual([KEY, KEY]);
  });

  it('przekroczony limit → RATE_LIMITED, RPC niewołane', async () => {
    vi.mocked(checkRateLimit).mockResolvedValue(false);
    expect(await applyToJob(application)).toEqual({ ok: false, error: 'RATE_LIMITED' });
    expect(checkRateLimit).toHaveBeenCalledWith('apply', expect.any(Object));
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['brak zgody na regulamin', { ...application, agreeTerms: false }],
    ['jobId nie-UUID', { ...application, jobId: 'oferta-1' }],
    ['klucz idempotencji nie-UUID', { ...application, idempotencyKey: 'klik-1' }],
  ])('niepoprawne dane (%s) → VALIDATION_FAILED, RPC niewołane', async (_label, input) => {
    expect(await applyToJob(input as never)).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(rpc).not.toHaveBeenCalled();
  });

  // applyToJob odróżnia brak sesji (UNAUTHENTICATED → link logowania w modalu) od PERMISSION_DENIED.
  const APPLY_ERRORS = PG_ERRORS.map(([message, code]): [string, string] =>
    message === 'UNAUTHENTICATED' ? [message, 'UNAUTHENTICATED'] : [message, code],
  );

  it.each(APPLY_ERRORS)('błąd RPC „%s” → %s bez technikaliów', async (message, code) => {
    rpc.mockResolvedValue({ data: null, error: { message } });
    const result = await applyToJob(application);
    expect(result).toEqual({ ok: false, error: code });
    expectNoTechnicalText(result, message);
  });
});

describe('transitionApplication', () => {
  it('sukces: przekazuje identyfikator i status docelowy', async () => {
    expect(await transitionApplication(OFFER, 'shortlisted')).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith('transition_application', {
      p_application_id: OFFER,
      p_target: 'shortlisted',
    });
  });

  it.each([
    ['niedozwolone przejście hired → rejected', 'INVALID_TRANSITION'],
    ['status zmienił się równolegle', 'INVALID_TRANSITION'],
    ...PG_ERRORS,
  ])('błąd RPC „%s” → %s', async (message, code) => {
    rpc.mockResolvedValue({ data: null, error: { message } });
    const result = await transitionApplication(OFFER, 'rejected');
    expect(result).toEqual({ ok: false, error: code });
    expectNoTechnicalText(result, message);
  });
});

describe('sendOffer', () => {
  const offer = { jobId: JOB, candidateId: CANDIDATE, idempotencyKey: KEY };

  it('sukces: klucz idempotencji klienta trafia do send_offer bez zmian, brak treści → NULL', async () => {
    expect(await sendOffer(offer)).toEqual({ ok: true, id: 'row-1' });
    expect(rpc).toHaveBeenCalledWith('send_offer', {
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
    expect(rpc).not.toHaveBeenCalled();
  });

  it('za krótka treść → VALIDATION_FAILED, RPC niewołane', async () => {
    expect(await sendOffer({ ...offer, message: 'Hej' })).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each(PG_ERRORS)('błąd RPC „%s” → %s bez technikaliów', async (message, code) => {
    rpc.mockResolvedValue({ data: null, error: { message } });
    const result = await sendOffer(offer);
    expect(result).toEqual({ ok: false, error: code });
    expectNoTechnicalText(result, message);
  });
});

describe('respondToOffer', () => {
  it('sukces: akceptacja trafia do respond_to_offer', async () => {
    expect(await respondToOffer(OFFER, true)).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith('respond_to_offer', { p_offer_id: OFFER, p_accept: true });
  });

  it.each(['', 'oferta-1', `${OFFER}x`])('identyfikator „%s” → VALIDATION_FAILED bez RPC', async (id) => {
    expect(await respondToOffer(id, false)).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each(PG_ERRORS.filter(([, code]) => code !== 'COMPANY_NOT_VERIFIED'))(
    'błąd RPC „%s” → %s bez technikaliów',
    async (message, code) => {
      rpc.mockResolvedValue({ data: null, error: { message } });
      const result = await respondToOffer(OFFER, false);
      expect(result).toEqual({ ok: false, error: code });
      expectNoTechnicalText(result, message);
    },
  );
});

describe('wiadomości', () => {
  const MSG_ERRORS = PG_ERRORS.filter(([, code]) => !['COMPANY_NOT_VERIFIED', 'JOB_NOT_ACTIVE'].includes(code));

  it('openConversation: dokładnie jedna relacja, inaczej VALIDATION_FAILED bez RPC', async () => {
    expect(await openConversation({})).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(await openConversation({ applicationId: JOB, offerId: OFFER })).toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(await openConversation({ offerId: OFFER })).toEqual({ ok: true, id: 'row-1' });
    expect(rpc).toHaveBeenCalledWith('get_or_create_conversation', {
      p_application_id: null,
      p_offer_id: OFFER,
    });
  });

  it('sendMessage: sukces i limit przed RPC', async () => {
    expect(await sendMessage(CONVERSATION, 'Dzień dobry, kiedy mogę przyjść?', CLIENT_MSG)).toEqual({
      ok: true,
      id: 'row-1',
    });
    expect(rpc).toHaveBeenCalledWith('send_message', {
      p_conversation_id: CONVERSATION,
      p_body: 'Dzień dobry, kiedy mogę przyjść?',
      p_client_message_id: CLIENT_MSG,
    });
    rpc.mockClear();
    vi.mocked(checkRateLimit).mockResolvedValue(false);
    expect(await sendMessage(CONVERSATION, 'Druga wiadomość', CLIENT_MSG)).toEqual({
      ok: false,
      error: 'RATE_LIMITED',
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('sendMessage: pusta treść → VALIDATION_FAILED bez RPC', async () => {
    expect(await sendMessage(CONVERSATION, '   ', CLIENT_MSG)).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each(['', 'msg-1', `${CLIENT_MSG}x`])('sendMessage: klucz operacji „%s” nie-UUID → VALIDATION_FAILED bez RPC (#147)', async (key) => {
    expect(await sendMessage(CONVERSATION, 'Dzień dobry', key)).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each(MSG_ERRORS)('sendMessage/openConversation/markConversationRead: „%s” → %s', async (message, code) => {
    rpc.mockResolvedValue({ data: null, error: { message } });
    for (const result of [
      await sendMessage(CONVERSATION, 'Dzień dobry', CLIENT_MSG),
      await openConversation({ applicationId: JOB }),
      await markConversationRead(CONVERSATION),
    ]) {
      expect(result).toEqual({ ok: false, error: code });
      expectNoTechnicalText(result, message);
    }
  });
});

describe('loadOlderMessages', () => {
  const CURSOR = { createdAt: '2026-09-20T10:00:00.000Z', id: OFFER };

  it.each([
    ['nieobsługiwany język', 'de', CONVERSATION, CURSOR],
    ['konwersacja nie-UUID', 'pl', 'c-1', CURSOR],
    ['kursor bez daty', 'pl', CONVERSATION, { id: OFFER }],
  ])('%s → error bez odczytu', async (_label, locale, conversation, cursor) => {
    expect(await loadOlderMessages(locale, conversation, cursor)).toEqual({ status: 'error' });
    expect(getOlderThreadMessages).not.toHaveBeenCalled();
  });

  it('strona starszych wiadomości: odczyt pod sesją i etykieta czasu w języku strony', async () => {
    const message = { id: JOB, body: 'Dzień dobry', createdAt: '2026-09-19T08:30:00.000Z', mine: false };
    vi.mocked(getOlderThreadMessages).mockResolvedValue({
      status: 'ready',
      messages: [message],
      olderCursor: null,
    } as never);
    const result = await loadOlderMessages('nl', CONVERSATION, CURSOR);
    expect(getOlderThreadMessages).toHaveBeenCalledWith(CONVERSATION, CURSOR);
    expect(result).toMatchObject({ status: 'ready', olderCursor: null, messages: [{ id: JOB, body: 'Dzień dobry' }] });
    expect(result.status === 'ready' && typeof result.messages[0]!.timeLabel).toBe('string');
  });

  it.each(['not-found', 'error'] as const)('wynik odczytu %s przekazany bez zmian', async (status) => {
    vi.mocked(getOlderThreadMessages).mockResolvedValue({ status } as never);
    expect(await loadOlderMessages('pl', CONVERSATION, CURSOR)).toEqual({ status });
  });
});

describe('saveOnboardingStep', () => {
  const STEP3 = { skills: ['wózek widłowy'], experienceYears: 3 };
  const STEP5 = { languages: [{ language: 'nl', level: 'basic' }], certificates: ['VCA'] };
  const STEP6 = { availability: 'immediate', preferredContractTypes: ['permanent'], agreeTerms: true };

  it('krok 3: umiejętności przez set_candidate_skills (nie bezpośredni DML)', async () => {
    expect(await saveOnboardingStep(3, STEP3)).toEqual({ ok: true });
    expect(upsert).toHaveBeenCalledWith(
      { profile_id: USER, experience_years: 3 },
      { onConflict: 'profile_id' },
    );
    expect(rpc).toHaveBeenCalledWith('set_candidate_skills', { p_skills: ['wózek widłowy'] });
  });

  it('krok 5: języki i certyfikaty przez set_candidate_languages/certificates', async () => {
    expect(await saveOnboardingStep(5, STEP5)).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith('set_candidate_languages', {
      p_languages: [{ language: 'nl', level: 'basic' }],
    });
    expect(rpc).toHaveBeenCalledWith('set_candidate_certificates', { p_certificates: ['VCA'] });
  });

  it('krok 6 z finish: finish_onboarding i receipt zgody', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    expect(await saveOnboardingStep(6, STEP6, { finish: true })).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith('finish_onboarding');
    expect(adminRpc).toHaveBeenCalledWith(
      'record_document_acceptance',
      expect.objectContaining({ p_profile_id: USER, p_documents: ['terms', 'privacy'] }),
    );
  });

  it('krok 6 z finish: profil niekompletny w DB → ONBOARDING_INCOMPLETE, bez receiptu', async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    expect(await saveOnboardingStep(6, STEP6, { finish: true })).toEqual({
      ok: false,
      error: 'ONBOARDING_INCOMPLETE',
    });
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it.each([
    [3, STEP3, 'set_candidate_skills'],
    [5, STEP5, 'set_candidate_languages'],
    [5, STEP5, 'set_candidate_certificates'],
    [6, STEP6, 'finish_onboarding'],
  ] as const)('krok %s: błąd RPC %s → ok:false (nie sukces)', async (step, data, failing) => {
    rpc.mockImplementation(async (name: string) =>
      name === failing
        ? { data: null, error: { message: 'new row violates row-level security policy' } }
        : { data: true, error: null },
    );
    const result = await saveOnboardingStep(step, data, { finish: step === 6 });
    expect(result).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    expectNoTechnicalText(result, 'violates policy');
  });

  it('błąd zapisu profilu (krok 1) → ok:false; nieoczekiwany wyjątek → INTERNAL', async () => {
    updateEq.mockResolvedValue({ error: { message: 'JWT expired' } });
    expect(await saveOnboardingStep(1, { firstName: 'Anna', lastName: 'Nowak' })).toEqual({
      ok: false,
      error: 'PERMISSION_DENIED',
    });
    upsert.mockRejectedValue(new Error('socket hang up at 10.0.0.1:5432'));
    const result = await saveOnboardingStep(2, { occupations: ['magazynier'], categories: ['warehouse'] });
    expect(result).toEqual({ ok: false, error: 'INTERNAL' });
    expect(JSON.stringify(result)).not.toContain('socket');
  });

  it('bez sesji → PERMISSION_DENIED, nic nie jest zapisywane', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect(await saveOnboardingStep(3, STEP3)).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    expect(upsert).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
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
    expect(getUser).not.toHaveBeenCalled();
  });
});

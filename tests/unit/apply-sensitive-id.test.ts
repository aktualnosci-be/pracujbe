import { beforeEach, describe, expect, it, vi } from 'vitest';

import { applyToJob } from '@/lib/actions/applications';
import { submitGuestApplication } from '@/lib/actions/guest-applications';
import { fakeDb, fakeSession, resetFakeDb } from '../helpers/fake-db';
import { applicationSchema, SENSITIVE_ID_MESSAGE_KEY } from '@/lib/validation/application';
import { guestApplicationSchema } from '@/lib/validation/guest-application';

/**
 * #495 — na etapie aplikacji nie zbieramy NISS/BIS, PESEL ani numerów dokumentów. Numer
 * w wiadomości do firmy albo w odpowiedzi na pytanie → błąd przy polu i BRAK wywołania RPC
 * (nic nie jest zapisywane). Zwykła wiadomość z kwotą/telefonem/datą przechodzi.
 * Numery są syntetyczne.
 */

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers({ 'x-real-ip': '203.0.113.9', 'user-agent': 'UA' })),
}));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(async () => true) }));
vi.mock('@/lib/turnstile/verify', () => ({ enforceTurnstile: vi.fn(async () => null) }));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));
vi.mock('@/lib/env', () => ({ isProductionMode: vi.fn(() => false) }));
vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());

const QUESTION = '33333333-3333-4333-8333-333333333333';
const NISS_MESSAGE = 'Dzień dobry, mój numer NISS to 85.07.30-033.28, mogę zacząć od zaraz.';

const candidateInput = {
  jobId: '11111111-1111-4111-8111-111111111111',
  agreeTerms: true as const,
  idempotencyKey: '22222222-2222-4222-8222-222222222222',
  phone: '+32 470 12 34 56',
  phoneCountry: 'BE' as const,
};

const guestInput = {
  jobId: '11111111-1111-4111-8111-111111111111',
  fullName: 'Anna Nowak',
  email: 'anna@example.com',
  locale: 'pl' as const,
  agreeTerms: true as const,
  ageConfirmed: true as const,
  minAge: 18,
  idempotencyKey: '22222222-2222-4222-8222-222222222222',
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GUEST_APPLY_SECRET = 's'.repeat(40);
  resetFakeDb({ id: '44444444-4444-4444-8444-444444444444', role: 'candidate' });
  fakeDb.rpc('apply_to_job', 'application-1').rpc('submit_guest_application', 'request-1');
});

describe('applyToJob — numery identyfikacyjne (#495)', () => {
  it('NISS w wiadomości → błąd pola „message” bez zapisu', async () => {
    expect(await applyToJob({ ...candidateInput, message: NISS_MESSAGE })).toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
      field: 'message',
      reason: 'sensitiveId',
    });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('numer paszportu w odpowiedzi na pytanie → błąd przy pytaniu bez zapisu', async () => {
    expect(
      await applyToJob({ ...candidateInput, answers: { [QUESTION]: 'Paszport nr EA1234567' } }),
    ).toEqual({ ok: false, error: 'VALIDATION_FAILED', questionId: QUESTION, reason: 'sensitiveId' });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('także w trybie demo (przed jakąkolwiek inną ścieżką)', async () => {
    fakeSession.configured = false;
    expect(await applyToJob({ ...candidateInput, jobId: '1002', message: NISS_MESSAGE })).toMatchObject({
      field: 'message',
      reason: 'sensitiveId',
    });
  });

  it('kontrola ujemna: zwykła wiadomość z kwotą, telefonem i datą jest zapisywana', async () => {
    const message = 'Oczekuję 2500 EUR brutto, tel. 0471 23 45 67, mogę od 01.10.2026. Mam paszport i prawo jazdy B.';
    expect(await applyToJob({ ...candidateInput, message, answers: { [QUESTION]: '5 lat' } })).toEqual({
      ok: true,
      id: 'application-1',
    });
    expect(fakeDb.callsTo('apply_to_job')[0]!.args).toMatchObject({ p_message: message });
  });
});

describe('submitGuestApplication — numery identyfikacyjne (#495)', () => {
  it('BIS w wiadomości gościa → błąd pola bez zapisu i bez e-maila', async () => {
    expect(await submitGuestApplication({ ...guestInput, message: 'BIS-nummer 85473003317' })).toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
      field: 'message',
      reason: 'sensitiveId',
    });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('karta eID w odpowiedzi gościa → błąd przy pytaniu', async () => {
    expect(
      await submitGuestApplication({ ...guestInput, answers: { [QUESTION]: 'eID 591-2345678-29' } }),
    ).toEqual({ ok: false, error: 'VALIDATION_FAILED', questionId: QUESTION, reason: 'sensitiveId' });
    expect(fakeDb.calls).toHaveLength(0);
  });
});

describe('schematy Zod (autorytatywna walidacja serwera)', () => {
  it('applicationSchema odrzuca NISS w wiadomości i w odpowiedzi z kluczem i18n przy polu', () => {
    const message = applicationSchema.safeParse({ ...candidateInput, message: NISS_MESSAGE });
    expect(message.success).toBe(false);
    expect(message.error?.issues[0]).toMatchObject({ path: ['message'], message: SENSITIVE_ID_MESSAGE_KEY });

    const answer = applicationSchema.safeParse({ ...candidateInput, answers: { [QUESTION]: 'PESEL 44051401359' } });
    expect(answer.success).toBe(false);
    expect(answer.error?.issues[0]).toMatchObject({ path: ['answers', QUESTION], message: SENSITIVE_ID_MESSAGE_KEY });
  });

  it('guestApplicationSchema odrzuca NISS w wiadomości', () => {
    const parsed = guestApplicationSchema.safeParse({ ...guestInput, message: NISS_MESSAGE });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]).toMatchObject({
      path: ['message'],
      message: 'guestApply.error.sensitiveIdNotAllowed',
    });
  });

  it('kontrola ujemna: niepoprawna suma bez słowa kluczowego przechodzi', () => {
    expect(applicationSchema.safeParse({ ...candidateInput, message: 'Numer oferty 85073003300' }).success).toBe(true);
  });
});

// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Bloker startu W1 (docs/LAUNCH_CHECKLIST.md §1): e-mail potwierdzający konto i link resetu
 * wychodzą zaraz po akcji (jedna paczka workera kont po odpowiedzi), nie dopiero z harmonogramu.
 * Kontrole ujemne: bez zlecenia w kolejce (limit, walidacja, nieudana rejestracja, złe hasło,
 * udane logowanie) worker nie jest planowany; `AUTH_EMAIL_IMMEDIATE_SEND=off` wyłącza wysyłkę
 * natychmiastową.
 */

const mocks = vi.hoisted(() => ({ rateLimit: vi.fn(), kick: vi.fn() }));

vi.mock('next-intl/server', () => ({ getLocale: async () => 'pl' }));
vi.mock('next/headers', async () => (await import('../helpers/auth-portal')).headersModule);
vi.mock('next/navigation', async () => (await import('../helpers/auth-portal')).navigationModule);
vi.mock('@/i18n/navigation', async () => (await import('../helpers/auth-portal')).intlNavigationModule);
vi.mock('@/lib/auth/runtime', async () => (await import('../helpers/auth-portal')).runtimeModule);
vi.mock('@/lib/db/runtime', async () => (await import('../helpers/auth-portal')).dbRuntimeModule);
vi.mock('@/lib/db/transaction', async () => (await import('../helpers/auth-portal')).transactionModule);
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mocks.rateLimit }));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));
vi.mock('@/lib/auth/email-kick', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/email-kick')>()),
  kickAuthEmailQueue: mocks.kick,
}));

import { api, authApiError, outcome, redirectTarget, resetPortal, stubPortalEnv } from '../helpers/auth-portal';
import { registerCandidate, registerEmployer, requestPasswordReset, signIn } from '@/lib/actions/auth';
import { AUTH_EMAIL_KICK_LIMIT, authEmailKickEnabled } from '@/lib/auth/email-kick';

const candidate = {
  email: 'jan@example.com',
  password: 'Haslo1234',
  passwordConfirm: 'Haslo1234',
  firstName: 'Jan',
  lastName: 'Kowalski',
  locale: 'nl' as const,
  ageConfirmed: true as const,
  minAge: 18,
  agreeTerms: true as const,
  privacyNoticeAck: true as const,
};
const { ageConfirmed: _a, minAge: _m, ...employerBase } = candidate;
const employer = { ...employerBase, companyName: 'Firma Testowa' };
const credentials = { email: 'jan@example.com', password: 'Haslo1234' };

beforeEach(() => {
  resetPortal();
  stubPortalEnv();
  mocks.rateLimit.mockReset().mockResolvedValue(true);
  mocks.kick.mockReset().mockReturnValue(true);
  api.signUpEmail.mockResolvedValue({ token: null, user: { id: 'u1' } });
});
afterEach(() => vi.unstubAllEnvs());

describe('akcje kont planują wysyłkę zaraz po zleceniu', () => {
  it('rejestracja kandydata i pracodawcy', async () => {
    expect(await redirectTarget(() => registerCandidate(candidate as never))).toBe('/nl/potwierdzenie');
    expect(await redirectTarget(() => registerEmployer(employer as never))).toBe('/nl/potwierdzenie');
    expect(api.signUpEmail).toHaveBeenCalledTimes(2);
    expect(mocks.kick).toHaveBeenCalledTimes(2);
  });

  it('reset hasła — zawsze, także przy awarii zlecenia (wynik neutralny, bez sygnału o koncie)', async () => {
    expect(await requestPasswordReset({ email: 'jest@example.com' })).toEqual({ ok: true });
    api.requestPasswordReset.mockRejectedValue(authApiError(500, 'AUTH_EMAIL_QUEUE_FAILED'));
    expect(await requestPasswordReset({ email: 'brak@example.com' })).toEqual({ ok: true });
    expect(mocks.kick).toHaveBeenCalledTimes(2);
  });

  it('logowanie niepotwierdzonego konta (SDK zleca nowy link)', async () => {
    api.signInEmail.mockRejectedValue(authApiError(403, 'EMAIL_NOT_VERIFIED'));
    expect(await signIn(credentials)).toEqual({ ok: false, error: 'AUTH_EMAIL_NOT_CONFIRMED' });
    expect(mocks.kick).toHaveBeenCalledTimes(1);
  });
});

describe('kontrole ujemne — bez zlecenia brak wysyłki', () => {
  it('limit prób', async () => {
    mocks.rateLimit.mockResolvedValue(false);
    await outcome(() => registerCandidate(candidate as never));
    await requestPasswordReset({ email: 'jest@example.com' });
    await signIn(credentials);
    expect(mocks.kick).not.toHaveBeenCalled();
  });

  it('walidacja i nieudana rejestracja', async () => {
    await outcome(() => registerCandidate({ ...candidate, agreeTerms: false } as never));
    await requestPasswordReset({ email: 'nie-adres' });
    api.signUpEmail.mockRejectedValue(authApiError(500, 'FAILED_TO_CREATE_USER'));
    expect(await outcome(() => registerCandidate(candidate as never))).toMatchObject({ ok: false });
    expect(mocks.kick).not.toHaveBeenCalled();
  });

  it('złe hasło i udane logowanie', async () => {
    await redirectTarget(() => signIn(credentials));
    api.signInEmail.mockRejectedValue(authApiError(401, 'INVALID_EMAIL_OR_PASSWORD'));
    expect(await signIn(credentials)).toEqual({ ok: false, error: 'AUTH_INVALID_CREDENTIALS' });
    expect(mocks.kick).not.toHaveBeenCalled();
  });
});

describe('kickAuthEmailQueue', () => {
  async function realKick() {
    return (await vi.importActual<typeof import('@/lib/auth/email-kick')>('@/lib/auth/email-kick')).kickAuthEmailQueue;
  }

  it('planuje jedną małą paczkę workera kont po odpowiedzi', async () => {
    const kick = await realKick();
    const tasks: Array<() => Promise<void>> = [];
    const process = vi.fn(async () => ({ ok: true }));
    expect(kick({ env: {}, schedule: (task) => void tasks.push(task), process })).toBe(true);
    expect(process).not.toHaveBeenCalled(); // dopiero po odpowiedzi
    await tasks[0]!();
    expect(process).toHaveBeenCalledWith(AUTH_EMAIL_KICK_LIMIT);
  });

  it('kontrola ujemna: AUTH_EMAIL_IMMEDIATE_SEND=off — nic nie jest planowane', async () => {
    const kick = await realKick();
    const schedule = vi.fn();
    expect(kick({ env: { AUTH_EMAIL_IMMEDIATE_SEND: 'off' }, schedule })).toBe(false);
    expect(schedule).not.toHaveBeenCalled();
    expect(authEmailKickEnabled({ AUTH_EMAIL_IMMEDIATE_SEND: 'off' })).toBe(false);
    expect(authEmailKickEnabled({})).toBe(true);
  });

  it('awaria planowania i workera nie rzuca (zlecenie zostaje dla harmonogramu)', async () => {
    const kick = await realKick();
    expect(kick({ env: {}, schedule: () => { throw new Error('outside request scope'); } })).toBe(false);
    // Bez `schedule`: prawdziwe `after` poza żądaniem rzuca — akcja i tak nie dostaje wyjątku.
    expect(kick({ env: {} })).toBe(false);
    const tasks: Array<() => Promise<void>> = [];
    kick({ env: {}, schedule: (task) => void tasks.push(task), process: async () => { throw new Error('db'); } });
    await expect(tasks[0]!()).resolves.toBeUndefined();
  });
});

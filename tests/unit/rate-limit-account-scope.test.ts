import { beforeEach, describe, expect, it, vi } from 'vitest';

import { applyToJob } from '@/lib/actions/applications';
import { sendMessage } from '@/lib/actions/messages';
import { checkRateLimit } from '@/lib/rate-limit';
import { fakeDb, fakeSession, resetFakeDb } from '../helpers/fake-db';
import { useRecruitmentMode as withRecruitmentMode } from '../helpers/portal-mode';

// Przepływ rekrutacyjny (#1128): w trybie ogłoszeniowym ta ścieżka jest wyłączona (#1134/#1138).
withRecruitmentMode();

/**
 * #852 — anonimowy ruch (bez sesji) nie może zużywać limitu aplikacji/wiadomości liczonego
 * wyłącznie po IP, bo wyczerpuje wspólny bucket zalogowanym użytkownikom za tym samym
 * NAT/CGNAT. Poprawka: sesja PRZED limitem (brak konta = brak zużycia jakiegokolwiek
 * licznika) i limit biznesowy liczony PER KONTO (`identifier`, `perIp: false`), niezależnie
 * od adresu — dwa konta za tym samym IP mają niezależne budżety, a jedno konto nie omija
 * swojego limitu zmieniając sieć. Dodatkowa, szeroka ochrona IP przed automatyzacją wielu
 * kont zostaje jako osobny, wyższy próg (`apply-ip` / `message-ip`).
 */

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(async () => true) }));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

const USER = '11111111-1111-4111-8111-111111111111';
const JOB = '22222222-2222-4222-8222-222222222222';
const KEY = '33333333-3333-4333-8333-333333333333';
const CONVERSATION = '55555555-5555-4555-8555-555555555555';
const CLIENT_MSG = '66666666-6666-4666-8666-666666666666';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkRateLimit).mockResolvedValue(true);
  resetFakeDb({ id: USER, role: 'candidate' });
  fakeDb.rpc('apply_to_job', 'application-1');
  fakeDb.rpc('send_message', 'message-1');
});

describe('applyToJob — limit per konto (#852)', () => {
  it('konto zalogowane: limit biznesowy liczony po identyfikatorze konta, nie po IP', async () => {
    await applyToJob({ jobId: JOB, agreeTerms: true, idempotencyKey: KEY });
    const businessCall = vi.mocked(checkRateLimit).mock.calls.find(([action]) => action === 'apply');
    expect(businessCall).toBeDefined();
    const [, opts] = businessCall!;
    // Kontrola ujemna: bez tej poprawki limit budowałby klucz tylko z IP (bez `identifier`,
    // `perIp` domyślnie `true`) — dwa konta za tym samym adresem dzieliłyby jeden budżet.
    expect(opts).toMatchObject({ identifier: USER, perIp: false });
  });

  it('anonimowe wywołanie (bez sesji) nie zużywa ŻADNEGO licznika — UNAUTHENTICATED przed limitem', async () => {
    fakeSession.identity = null;
    const result = await applyToJob({ jobId: JOB, agreeTerms: true, idempotencyKey: KEY });
    expect(result).toEqual({ ok: false, error: 'UNAUTHENTICATED' });
    // Kontrola ujemna: przed poprawką limiter był wołany przed sprawdzeniem sesji — anonimowe
    // żądanie zdążyłoby zużyć bucket dzielony ze zalogowanym użytkownikiem tego samego IP.
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('dodatkowa ochrona sieciowa (apply-ip) ma znacznie wyższy próg niż limit konta', async () => {
    await applyToJob({ jobId: JOB, agreeTerms: true, idempotencyKey: KEY });
    const networkCall = vi.mocked(checkRateLimit).mock.calls.find(([action]) => action === 'apply-ip');
    expect(networkCall).toBeDefined();
    const [, opts] = networkCall!;
    expect((opts as { max: number }).max).toBeGreaterThan(20);
  });

  it('limit konta przekroczony → RATE_LIMITED, RPC niewołane (kontrola pozytywna)', async () => {
    vi.mocked(checkRateLimit).mockImplementation(async (action) => action !== 'apply');
    const result = await applyToJob({ jobId: JOB, agreeTerms: true, idempotencyKey: KEY });
    expect(result).toEqual({ ok: false, error: 'RATE_LIMITED' });
    expect(fakeDb.calls).toHaveLength(0);
  });
});

describe('sendMessage — limit per konto (#852)', () => {
  it('konto zalogowane: limit biznesowy liczony po identyfikatorze konta, nie po IP', async () => {
    await sendMessage(CONVERSATION, 'Dzień dobry', CLIENT_MSG);
    const businessCall = vi.mocked(checkRateLimit).mock.calls.find(([action]) => action === 'message');
    expect(businessCall).toBeDefined();
    const [, opts] = businessCall!;
    expect(opts).toMatchObject({ identifier: USER, perIp: false });
  });

  it('anonimowe, poprawnie sformatowane wywołanie nie zużywa ŻADNEGO licznika', async () => {
    fakeSession.identity = null;
    const result = await sendMessage(CONVERSATION, 'Dzień dobry', CLIENT_MSG);
    expect(result).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('dodatkowa ochrona sieciowa (message-ip) ma znacznie wyższy próg niż limit konta', async () => {
    await sendMessage(CONVERSATION, 'Dzień dobry', CLIENT_MSG);
    const networkCall = vi.mocked(checkRateLimit).mock.calls.find(([action]) => action === 'message-ip');
    expect(networkCall).toBeDefined();
    const [, opts] = networkCall!;
    expect((opts as { max: number }).max).toBeGreaterThan(60);
  });

  it('limit konta przekroczony → RATE_LIMITED, RPC niewołane (kontrola pozytywna)', async () => {
    vi.mocked(checkRateLimit).mockImplementation(async (action) => action !== 'message');
    const result = await sendMessage(CONVERSATION, 'Dzień dobry', CLIENT_MSG);
    expect(result).toEqual({ ok: false, error: 'RATE_LIMITED' });
    expect(fakeDb.calls).toHaveLength(0);
  });
});

describe('dwa konta za tym samym IP mają niezależne budżety (#852)', () => {
  it('limit budowany jest tylko z identyfikatora konta — inny UUID daje inny klucz logiczny', async () => {
    resetFakeDb({ id: USER, role: 'candidate' });
    await applyToJob({ jobId: JOB, agreeTerms: true, idempotencyKey: KEY });
    const OTHER_USER = '77777777-7777-4777-8777-777777777777';
    resetFakeDb({ id: OTHER_USER, role: 'candidate' });
    fakeDb.rpc('apply_to_job', 'application-2');
    await applyToJob({ jobId: JOB, agreeTerms: true, idempotencyKey: KEY });
    const identifiers = vi
      .mocked(checkRateLimit)
      .mock.calls.filter(([action]) => action === 'apply')
      .map(([, opts]) => (opts as { identifier?: string }).identifier);
    expect(identifiers).toEqual([USER, OTHER_USER]);
    expect(new Set(identifiers).size).toBe(2);
  });
});

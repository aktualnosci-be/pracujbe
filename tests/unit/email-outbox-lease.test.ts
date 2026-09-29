import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { EMAIL_LEASE_SECONDS, SEND_DEADLINE_MS, processEmailQueue } from '@/lib/email/outbox';
import { captureError } from '@/lib/error-report';
import { fakeDb, pgError, resetFakeDb } from '../helpers/fake-db';
import { warmUpEmailRender } from '../helpers/email-render-warmup';

/**
 * #615 — worker poczty nie może wysłać wiersza po utracie dzierżawy. `claim_email_batch`
 * nadaje `lock_token` (0129); `email_delivery_send_check` i każda dalsza aktualizacja wiersza
 * (mark-sent/mark-failed/defer) muszą go podać jako CAS. Zachowanie samego RPC (dwaj workerzy,
 * wygasła dzierżawa) — `supabase/tests/rls.sql` sekcja WL615.
 *
 * #621 (dokończenie #615) — od strony workera (JS) nic się nie zmienia: `processEmailQueue`
 * przekazuje ten sam `p_lock_token` do `email_delivery_send_check` jak dotąd. Naprawa (0131)
 * jest wyłącznie po stronie bazy: `send_check` ODNAWIA dzierżawę (`locked_at = now()`) TUŻ
 * PRZED wywołaniem `transport.send`, więc czas trwania żądania do dostawcy dostaje pełne,
 * świeże okno, niezależnie od tego, ile z pierwotnej dzierżawy claimu już upłynęło (koniec
 * wyścigu TOCTOU między kontrolą a wysyłką). Dowód RPC (dwaj workerzy, dzierżawa prawie
 * wygasła w chwili kontroli, potem czas trwania wysyłki) — `supabase/tests/rls.sql` sekcja WL621.
 */

const { send } = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock('resend', () => ({ Resend: class { emails = { send }; } } ));
vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

const SITE = 'https://pracuj.be';

// Pierwszy render React Email (leniwy import react-dom/server) poza limitem pierwszego testu.
beforeAll(warmUpEmailRender);

function row(id: string, lockToken: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    profile_id: null,
    to_email: `${id}@example.test`,
    template: 'jobPublished',
    locale: 'nl',
    payload: { jobTitle: 'Magazijnier' },
    attempts: 0,
    lock_token: lockToken,
    ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetFakeDb(null)
    .rows('email.outbox.recipient-names', [])
    .exec('email.outbox.defer')
    .exec('email.outbox.defer-config')
    .exec('email.outbox.mark-sent')
    .exec('email.outbox.mark-failed');
  process.env.RESEND_API_KEY = 're_test';
  delete process.env.EMAIL_FROM;
  process.env.NEXT_PUBLIC_SITE_URL = SITE;
  send.mockResolvedValue({ data: { id: 'provider-1' }, error: null });
  vi.mocked(captureError).mockClear();
});

describe('#615 — token dzierżawy przekazywany od claimu do każdej dalszej aktualizacji', () => {
  it('email_delivery_send_check dostaje p_lock_token dokładnie taki, jaki zwrócił claim', async () => {
    fakeDb.rpc('claim_email_batch', [row('d1', 'token-abc')]);
    fakeDb.rpc('email_delivery_send_check', null);
    fakeDb.rpc('take_email_send_budget', [{ granted: true, retry_at: null }]);
    expect(await processEmailQueue()).toMatchObject({ sent: 1, ok: true });
    expect(fakeDb.callsTo('email_delivery_send_check')).toEqual([
      expect.objectContaining({ args: { p_delivery_id: 'd1', p_lock_token: 'token-abc' } }),
    ]);
  });

  it('"lease_lost" (dzierżawa przejęta przez inny worker): brak budżetu, brak wysyłki, brak zapisu — wiersz nie jest już nasz', async () => {
    fakeDb.rpc('claim_email_batch', [row('d1', 'stale-token')]);
    fakeDb.rpc('email_delivery_send_check', 'lease_lost');
    fakeDb.rpc('take_email_send_budget', () => {
      throw new Error('budżet nie powinien być pobrany po utracie dzierżawy');
    });
    const result = await processEmailQueue();
    expect(result).toMatchObject({ processed: 1, sent: 0, failed: 0, suppressed: 0, leaseLost: 1, ok: true });
    expect(send).not.toHaveBeenCalled();
    // Żadna aktualizacja wiersza (mark-sent/mark-failed/defer) — należy już do innego workera.
    expect(fakeDb.calls.filter((c) => c.kind === 'exec')).toHaveLength(0);
  });

  it('KONTROLA UJEMNA: bez utraty dzierżawy (null) ten sam wiersz wychodzi normalnie', async () => {
    fakeDb.rpc('claim_email_batch', [row('d1', 'token-abc')]);
    fakeDb.rpc('email_delivery_send_check', null);
    fakeDb.rpc('take_email_send_budget', [{ granted: true, retry_at: null }]);
    expect(await processEmailQueue()).toMatchObject({ sent: 1, leaseLost: 0 });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('mark-sent, mark-failed i defer niosą lock_token jako warunek CAS (nie tylko id)', async () => {
    // mark-sent
    fakeDb.rpc('claim_email_batch', [row('sent-1', 'lt-sent')]);
    fakeDb.rpc('email_delivery_send_check', null);
    fakeDb.rpc('take_email_send_budget', [{ granted: true, retry_at: null }]);
    await processEmailQueue();
    const [markSent] = fakeDb.callsTo('email.outbox.mark-sent');
    expect(markSent!.text).toMatch(/AND lock_token = \$5$/);
    expect(markSent!.values).toEqual(['sent-1', 'provider-1', 1, 'resend', 'lt-sent']);
  });

  it('mark-failed niesie lock_token jako CAS', async () => {
    resetFakeDb(null)
      .rows('email.outbox.recipient-names', [])
      .exec('email.outbox.defer')
      .exec('email.outbox.mark-sent')
      .exec('email.outbox.mark-failed');
    fakeDb.rpc('claim_email_batch', [row('fail-1', 'lt-fail')]);
    fakeDb.rpc('email_delivery_send_check', () => {
      throw pgError('08006', 'db down');
    });
    await processEmailQueue();
    const [markFailed] = fakeDb.callsTo('email.outbox.mark-failed');
    expect(markFailed!.text).toMatch(/AND lock_token = \$6$/);
    const [id, status, attempts, errorMessage, nextAttemptAt, lockToken] = markFailed!.values;
    expect({ id, status, attempts, errorMessage, lockToken }).toEqual({
      id: 'fail-1',
      status: 'queued',
      attempts: 1,
      errorMessage: 'db down',
      lockToken: 'lt-fail',
    });
    expect(typeof nextAttemptAt).toBe('string');
  });

  describe('trwałe odrzucenie a awaria przejściowa dostawcy', () => {
    function claimAttempts(id: string, attempts: number) {
      fakeDb.rpc('claim_email_batch', [row(id, `lt-${id}`, { attempts })]);
      fakeDb.rpc('email_delivery_send_check', null);
      fakeDb.rpc('take_email_send_budget', [{ granted: true, retry_at: null }]);
    }

    it('odrzucenie listu (delivery_failed): od razu "failed", bez kolejnych prób', async () => {
      send.mockResolvedValueOnce({ data: null, error: { name: 'validation_error', message: 'x' } });
      claimAttempts('rej-1', 0);
      expect(await processEmailQueue()).toMatchObject({ sent: 0, failed: 1 });
      const [, status, attempts, errorMessage] = fakeDb.callsTo('email.outbox.mark-failed')[0]!.values;
      expect({ status, attempts, errorMessage }).toEqual({
        status: 'failed',
        attempts: 1,
        errorMessage: 'EMAIL_PROVIDER_REJECTED',
      });
    });

    it('KONTROLA UJEMNA: awaria przejściowa wraca do kolejki ("queued") do wyczerpania prób', async () => {
      send.mockResolvedValueOnce({ data: null, error: { name: 'internal_server_error', message: 'x' } });
      claimAttempts('tmp-1', 0);
      await processEmailQueue();
      expect(fakeDb.callsTo('email.outbox.mark-failed')[0]!.values[1]).toBe('queued');
    });

    it('KONTROLA UJEMNA: limit konta u dostawcy nie kończy wiersza (ponowienie z backoffem)', async () => {
      send.mockResolvedValueOnce({ data: null, error: { name: 'daily_quota_exceeded', message: 'x' } });
      claimAttempts('cfg-quota', 0);
      await processEmailQueue();
      expect(fakeDb.callsTo('email.outbox.mark-failed')[0]!.values[1]).toBe('queued');
    });

    describe('#1214 — błąd konfiguracji nadawcy/dostawcy', () => {
      it.each([
        ['invalid_api_key', 'x'],
        ['invalid_from_address', 'x'],
        ['validation_error', 'The pracuj.be domain is not verified. Please, add and verify your domain.'],
      ])('%s: odłożenie bez zużycia próby, kod EMAIL_PROVIDER_CONFIG, reszta paczki czeka, ok=false', async (name, message) => {
        send.mockResolvedValueOnce({ data: null, error: { name, message } });
        fakeDb.rpc('claim_email_batch', [row('c1', 'lt-c1', { attempts: 2 }), row('c2', 'lt-c2')]);
        fakeDb.rpc('email_delivery_send_check', null);
        fakeDb.rpc('take_email_send_budget', [{ granted: true, retry_at: null }]);
        const result = await processEmailQueue();
        expect(result).toMatchObject({ sent: 0, failed: 0, deferred: 2, configBlocked: 2, ok: false });
        expect(send).toHaveBeenCalledTimes(1);
        expect(fakeDb.callsTo('email.outbox.mark-failed')).toHaveLength(0);
        const deferred = fakeDb.callsTo('email.outbox.defer-config');
        expect(deferred.map((c) => [c.values[0], c.values[2], c.values[3]])).toEqual([
          ['c1', 'lt-c1', 'EMAIL_PROVIDER_CONFIG'],
          ['c2', 'lt-c2', 'EMAIL_PROVIDER_CONFIG'],
        ]);
        // `attempts` nie jest zapisywane (brak kolumny w UPDATE) — próba niezużyta.
        expect(deferred[0]!.text).not.toMatch(/attempts/);
        expect(deferred[0]!.text).toMatch(/AND lock_token = \$3/);
        expect(Date.parse(String(deferred[0]!.values[1]))).toBeGreaterThan(Date.now());
      });

      it('KONTROLA UJEMNA: odrzucenie adresata (validation_error o `to`) nadal kończy wiersz jako failed', async () => {
        send.mockResolvedValueOnce({ data: null, error: { name: 'validation_error', message: 'Invalid `to` field.' } });
        claimAttempts('rcpt-1', 0);
        expect(await processEmailQueue()).toMatchObject({ failed: 1, ok: true });
        expect(fakeDb.callsTo('email.outbox.mark-failed')[0]!.values[1]).toBe('failed');
        expect(fakeDb.callsTo('email.outbox.defer-config')).toHaveLength(0);
      });

      it('nieużywalny EMAIL_FROM: worker nie pobiera kolejki (nic nie przechodzi w failed)', async () => {
        process.env.EMAIL_FROM = 'Pracuj.be no-reply@pracuj.be';
        fakeDb.rpc('claim_email_batch', [row('never', 'lt-never')]);
        const result = await processEmailQueue();
        expect(result).toMatchObject({ processed: 0, skipped: 'email sender invalid' });
        expect(fakeDb.callsTo('claim_email_batch')).toHaveLength(0);
        expect(send).not.toHaveBeenCalled();
      });

      it('EMAIL_FROM z otaczającymi cudzysłowami (.env.example) jest poprawiany i list wychodzi', async () => {
        process.env.EMAIL_FROM = '"Pracuj.be <no-reply@pracuj.be>"';
        fakeDb.rpc('claim_email_batch', [row('q1', 'lt-q1')]);
        fakeDb.rpc('email_delivery_send_check', null);
        fakeDb.rpc('take_email_send_budget', [{ granted: true, retry_at: null }]);
        expect(await processEmailQueue()).toMatchObject({ sent: 1, ok: true });
        expect(send.mock.calls[0]![0].from).toBe('Pracuj.be <no-reply@pracuj.be>');
      });
    });

    it('po wyczerpaniu prób awaria przejściowa też kończy jako "failed"', async () => {
      send.mockResolvedValueOnce({ data: null, error: { name: 'internal_server_error', message: 'x' } });
      claimAttempts('last-1', 4);
      await processEmailQueue();
      expect(fakeDb.callsTo('email.outbox.mark-failed')[0]!.values[1]).toBe('failed');
    });
  });

  it('defer niesie lock_token jako CAS (odmowa budżetu)', async () => {
    fakeDb.rpc('claim_email_batch', [row('defer-1', 'lt-defer')]);
    fakeDb.rpc('email_delivery_send_check', null);
    fakeDb.rpc('take_email_send_budget', [{ granted: false, retry_at: '2026-09-25T12:00:00.000Z' }]);
    await processEmailQueue();
    const [deferred] = fakeDb.callsTo('email.outbox.defer');
    expect(deferred!.text).toMatch(/AND lock_token = \$3$/);
    expect(deferred!.values).toEqual(['defer-1', '2026-09-25T12:00:00.000Z', 'lt-defer']);
  });

  it('CAS przegrany PO wysłaniu (rowCount 0 — dzierżawa wygasła w trakcie wolnej wysyłki): zgłoszone do rekoncyliacji, nie liczone jako błąd', async () => {
    resetFakeDb(null)
      .rows('email.outbox.recipient-names', [])
      .exec('email.outbox.defer')
      // 0 wierszy: inny worker już przejął ten wiersz między send_check a zapisem wyniku.
      .exec('email.outbox.mark-sent', 0)
      .exec('email.outbox.mark-failed');
    fakeDb.rpc('claim_email_batch', [row('race-1', 'lt-race')]);
    fakeDb.rpc('email_delivery_send_check', null);
    fakeDb.rpc('take_email_send_budget', [{ granted: true, retry_at: null }]);
    const result = await processEmailQueue();
    // Mail FAKTYCZNIE wyszedł (transport.send się powiódł) — liczymy jako wysłany.
    expect(result).toMatchObject({ sent: 1, failed: 0 });
    expect(captureError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ area: 'email.outbox.markSent.leaseLost', deliveryId: 'race-1' }),
    );
  });
});

describe('#628 — wysyłka nie trwa dłużej niż dzierżawa (brak równoległego ponowienia)', () => {
  function claimOne(id: string, token: string) {
    fakeDb.rpc('claim_email_batch', [row(id, token)]);
    fakeDb.rpc('email_delivery_send_check', null);
    fakeDb.rpc('take_email_send_budget', [{ granted: true, retry_at: null }]);
  }

  it('termin wysyłki jest co najmniej 2× krótszy niż dzierżawa, a claim dostaje tę dzierżawę jawnie', async () => {
    expect(SEND_DEADLINE_MS * 2).toBeLessThanOrEqual(EMAIL_LEASE_SECONDS * 1000);
    claimOne('d1', 'lt-1');
    await processEmailQueue();
    expect(fakeDb.callsTo('claim_email_batch')[0]).toMatchObject({
      args: { p_limit: 20, p_lease_seconds: EMAIL_LEASE_SECONDS },
    });
  });

  describe('zawieszony dostawca', () => {
    beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }));
    afterEach(() => vi.useRealTimers());

    it('po terminie: brak mark-sent, ponowienie najwcześniej po pełnej dzierżawie, spóźniony wynik pominięty', async () => {
      let resolveLate: (value: unknown) => void = () => undefined;
      send.mockReturnValueOnce(new Promise((resolve) => { resolveLate = resolve; }));
      claimOne('hang-1', 'lt-hang');
      const started = Date.now();
      const pending = processEmailQueue();
      await vi.advanceTimersByTimeAsync(SEND_DEADLINE_MS);
      const result = await pending;
      expect(result).toMatchObject({ sent: 0, failed: 1, ok: true });
      expect(fakeDb.callsTo('email.outbox.mark-sent')).toHaveLength(0);
      const [markFailed] = fakeDb.callsTo('email.outbox.mark-failed');
      const [, status, , errorMessage, nextAttemptAt, lockToken] = markFailed!.values;
      expect({ status, errorMessage, lockToken }).toEqual({
        status: 'queued',
        errorMessage: 'EMAIL_PROVIDER_UNAVAILABLE',
        lockToken: 'lt-hang',
      });
      expect(Date.parse(String(nextAttemptAt)) - started).toBeGreaterThanOrEqual(
        SEND_DEADLINE_MS + EMAIL_LEASE_SECONDS * 1000,
      );
      // Dostawca odpowiada po terminie — wynik nie jest już zapisywany (wiersz nie jest nasz).
      resolveLate({ data: { id: 'late-provider-id' }, error: null });
      await vi.advanceTimersByTimeAsync(0);
      expect(fakeDb.callsTo('email.outbox.mark-sent')).toHaveLength(0);
    });

    it('KONTROLA UJEMNA: odpowiedź przed terminem = zwykła wysyłka (mark-sent, bez ponowienia)', async () => {
      send.mockReturnValueOnce(new Promise((resolve) => {
        setTimeout(() => resolve({ data: { id: 'provider-slow' }, error: null }), SEND_DEADLINE_MS - 1);
      }));
      claimOne('slow-1', 'lt-slow');
      const pending = processEmailQueue();
      await vi.advanceTimersByTimeAsync(SEND_DEADLINE_MS - 1);
      expect(await pending).toMatchObject({ sent: 1, failed: 0 });
      expect(fakeDb.callsTo('email.outbox.mark-failed')).toHaveLength(0);
      expect(fakeDb.callsTo('email.outbox.mark-sent')[0]!.values[1]).toBe('provider-slow');
    });

    it('KONTROLA UJEMNA: zwykły błąd dostawcy zachowuje krótki backoff (2 min), nie pełną dzierżawę', async () => {
      send.mockResolvedValueOnce({ data: null, error: { name: 'internal_server_error', message: 'x' } });
      claimOne('err-1', 'lt-err');
      const started = Date.now();
      await processEmailQueue();
      const nextAttemptAt = fakeDb.callsTo('email.outbox.mark-failed')[0]!.values[4];
      const delay = Date.parse(String(nextAttemptAt)) - started;
      expect(delay).toBe(2 * 60_000);
      expect(delay).toBeLessThan(EMAIL_LEASE_SECONDS * 1000);
    });
  });
});

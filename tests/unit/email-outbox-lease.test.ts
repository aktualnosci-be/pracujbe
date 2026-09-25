import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeDb, pgError, resetFakeDb } from '../helpers/fake-db';

/**
 * #615 — worker poczty nie może wysłać wiersza po utracie dzierżawy. `claim_email_batch`
 * nadaje `lock_token` (0140); `email_delivery_send_check` i każda dalsza aktualizacja wiersza
 * (mark-sent/mark-failed/defer) muszą go podać jako CAS. Zachowanie samego RPC (dwaj workerzy,
 * wygasła dzierżawa) — `supabase/tests/rls.sql` sekcja WL615.
 *
 * #621 (dokończenie #615) — od strony workera (JS) nic się nie zmienia: `processEmailQueue`
 * przekazuje ten sam `p_lock_token` do `email_delivery_send_check` jak dotąd. Naprawa (0141)
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

beforeEach(async () => {
  vi.clearAllMocks();
  resetFakeDb(null)
    .rows('email.outbox.recipient-names', [])
    .exec('email.outbox.defer')
    .exec('email.outbox.mark-sent')
    .exec('email.outbox.mark-failed');
  process.env.RESEND_API_KEY = 're_test';
  process.env.NEXT_PUBLIC_SITE_URL = SITE;
  send.mockResolvedValue({ data: { id: 'provider-1' }, error: null });
  const { captureError } = await import('@/lib/error-report');
  vi.mocked(captureError).mockClear();
});

describe('#615 — token dzierżawy przekazywany od claimu do każdej dalszej aktualizacji', () => {
  it('email_delivery_send_check dostaje p_lock_token dokładnie taki, jaki zwrócił claim', async () => {
    fakeDb.rpc('claim_email_batch', [row('d1', 'token-abc')]);
    fakeDb.rpc('email_delivery_send_check', null);
    fakeDb.rpc('take_email_send_budget', [{ granted: true, retry_at: null }]);
    const { processEmailQueue } = await import('@/lib/email/outbox');
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
    const { processEmailQueue } = await import('@/lib/email/outbox');
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
    const { processEmailQueue } = await import('@/lib/email/outbox');
    expect(await processEmailQueue()).toMatchObject({ sent: 1, leaseLost: 0 });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('mark-sent, mark-failed i defer niosą lock_token jako warunek CAS (nie tylko id)', async () => {
    // mark-sent
    fakeDb.rpc('claim_email_batch', [row('sent-1', 'lt-sent')]);
    fakeDb.rpc('email_delivery_send_check', null);
    fakeDb.rpc('take_email_send_budget', [{ granted: true, retry_at: null }]);
    const { processEmailQueue } = await import('@/lib/email/outbox');
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
    const { processEmailQueue } = await import('@/lib/email/outbox');
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

  it('defer niesie lock_token jako CAS (odmowa budżetu)', async () => {
    fakeDb.rpc('claim_email_batch', [row('defer-1', 'lt-defer')]);
    fakeDb.rpc('email_delivery_send_check', null);
    fakeDb.rpc('take_email_send_budget', [{ granted: false, retry_at: '2026-09-25T12:00:00.000Z' }]);
    const { processEmailQueue } = await import('@/lib/email/outbox');
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
    const { processEmailQueue } = await import('@/lib/email/outbox');
    const { captureError } = await import('@/lib/error-report');
    const result = await processEmailQueue();
    // Mail FAKTYCZNIE wyszedł (transport.send się powiódł) — liczymy jako wysłany.
    expect(result).toMatchObject({ sent: 1, failed: 0 });
    expect(captureError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ area: 'email.outbox.markSent.leaseLost', deliveryId: 'race-1' }),
    );
  });
});

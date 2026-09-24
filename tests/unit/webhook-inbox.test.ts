import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeDb, pgError, resetFakeDb } from '../helpers/fake-db';

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());

const { claimWebhook, completeWebhook } = await import('@/lib/webhook-inbox');

/**
 * Testy inboxu webhooków ze stanem + dzierżawą (P0-01/P0-02/P2-06). Claim jest atomowy po
 * stronie DB (RPC `claim_webhook`, FOR UPDATE) i może zwrócić 'locked' (inny worker trzyma
 * świeżą dzierżawę). Helper woła RPC w transakcji service_role (#25) i mapuje wynik.
 */

beforeEach(() => {
  resetFakeDb(null);
});

describe('claimWebhook', () => {
  it("zwraca 'claimed' dla nowego zdarzenia / wygasłej dzierżawy", async () => {
    fakeDb.rpc('claim_webhook', 'claimed');
    expect(await claimWebhook('stripe:evt_1', 'stripe')).toBe('claimed');
  });

  it("zwraca 'duplicate' gdy wpis jest 'completed'", async () => {
    fakeDb.rpc('claim_webhook', 'duplicate');
    expect(await claimWebhook('stripe:evt_1', 'stripe')).toBe('duplicate');
  });

  it("zwraca 'locked' gdy inny worker trzyma świeżą dzierżawę (P2-06)", async () => {
    fakeDb.rpc('claim_webhook', 'locked');
    expect(await claimWebhook('stripe:evt_1', 'stripe')).toBe('locked');
  });

  it('przekazuje id/source/lock do RPC claim_webhook jako service_role', async () => {
    fakeDb.rpc('claim_webhook', 'claimed');
    await claimWebhook('stripe:evt_9', 'stripe', 120);
    const [call] = fakeDb.callsTo('claim_webhook');
    expect(call?.args).toEqual({ p_id: 'stripe:evt_9', p_source: 'stripe', p_lock_seconds: 120 });
    expect(call?.as).toBe('service');
  });

  it("zwraca 'error' gdy RPC zwraca błąd (inbox nieosiągalny)", async () => {
    fakeDb.rpc('claim_webhook', () => {
      throw pgError('XX000', 'boom');
    });
    expect(await claimWebhook('stripe:evt_1', 'stripe')).toBe('error');
  });

  it("zwraca 'error' dla nieznanej wartości wyniku", async () => {
    fakeDb.rpc('claim_webhook', 'weird');
    expect(await claimWebhook('stripe:evt_1', 'stripe')).toBe('error');
  });
});

describe('completeWebhook', () => {
  it('zwraca true gdy RPC complete_webhook oznaczył wpis', async () => {
    fakeDb.rpc('complete_webhook', true);
    expect(await completeWebhook('stripe:evt_1')).toBe(true);
    expect(fakeDb.callsTo('complete_webhook')[0]?.args).toEqual({ p_id: 'stripe:evt_1' });
  });

  it('zwraca false gdy wpisu nie ma (RPC false)', async () => {
    fakeDb.rpc('complete_webhook', false);
    expect(await completeWebhook('stripe:evt_1')).toBe(false);
  });

  it('zwraca false gdy RPC zwraca błąd (wołający → 500/retry)', async () => {
    fakeDb.rpc('complete_webhook', () => {
      throw pgError('08006', 'db down');
    });
    expect(await completeWebhook('stripe:evt_1')).toBe(false);
  });
});

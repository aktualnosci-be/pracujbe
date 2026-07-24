import { describe, expect, it, vi } from 'vitest';

import { claimWebhook, completeWebhook } from '@/lib/webhook-inbox';

/**
 * Testy inboxu webhooków ze stanem + dzierżawą (P0-01/P0-02/P2-06). Claim jest teraz atomowy
 * po stronie DB (RPC `claim_webhook`, FOR UPDATE) i może zwrócić 'locked' (inny worker trzyma
 * świeżą dzierżawę). Helper deleguje do `.rpc()` i mapuje wynik.
 *
 * Fake klienta odwzorowuje wyłącznie `.rpc(name, args)` → Promise<{ data, error }>.
 */

interface RpcResult {
  data: unknown;
  error: unknown;
}

function fakeAdmin(rpc: (name: string, args: unknown) => RpcResult) {
  return {
    rpc: (name: string, args: unknown) => Promise.resolve(rpc(name, args)),
  } as unknown as Parameters<typeof claimWebhook>[0];
}

describe('claimWebhook', () => {
  it("zwraca 'claimed' dla nowego zdarzenia / wygasłej dzierżawy", async () => {
    const admin = fakeAdmin(() => ({ data: 'claimed', error: null }));
    expect(await claimWebhook(admin, 'stripe:evt_1', 'stripe')).toBe('claimed');
  });

  it("zwraca 'duplicate' gdy wpis jest 'completed'", async () => {
    const admin = fakeAdmin(() => ({ data: 'duplicate', error: null }));
    expect(await claimWebhook(admin, 'stripe:evt_1', 'stripe')).toBe('duplicate');
  });

  it("zwraca 'locked' gdy inny worker trzyma świeżą dzierżawę (P2-06)", async () => {
    const admin = fakeAdmin(() => ({ data: 'locked', error: null }));
    expect(await claimWebhook(admin, 'stripe:evt_1', 'stripe')).toBe('locked');
  });

  it("przekazuje id/source/lock do RPC claim_webhook", async () => {
    const rpc = vi.fn((_name: string, _args: unknown) => ({ data: 'claimed', error: null }));
    const admin = fakeAdmin(rpc);
    await claimWebhook(admin, 'stripe:evt_9', 'stripe', 120);
    expect(rpc).toHaveBeenCalledWith('claim_webhook', {
      p_id: 'stripe:evt_9',
      p_source: 'stripe',
      p_lock_seconds: 120,
    });
  });

  it("zwraca 'error' gdy RPC zwraca błąd (inbox nieosiągalny)", async () => {
    const admin = fakeAdmin(() => ({ data: null, error: { message: 'boom' } }));
    expect(await claimWebhook(admin, 'stripe:evt_1', 'stripe')).toBe('error');
  });

  it("zwraca 'error' dla nieznanej wartości wyniku", async () => {
    const admin = fakeAdmin(() => ({ data: 'weird', error: null }));
    expect(await claimWebhook(admin, 'stripe:evt_1', 'stripe')).toBe('error');
  });
});

describe('completeWebhook', () => {
  it('zwraca true gdy RPC complete_webhook oznaczył wpis', async () => {
    const rpc = vi.fn((_name: string, _args: unknown) => ({ data: true, error: null }));
    const admin = fakeAdmin(rpc);
    expect(await completeWebhook(admin, 'stripe:evt_1')).toBe(true);
    expect(rpc).toHaveBeenCalledWith('complete_webhook', { p_id: 'stripe:evt_1' });
  });

  it('zwraca false gdy RPC zwraca błąd (wołający → 500/retry)', async () => {
    const admin = fakeAdmin(() => ({ data: null, error: { message: 'db down' } }));
    expect(await completeWebhook(admin, 'stripe:evt_1')).toBe(false);
  });
});

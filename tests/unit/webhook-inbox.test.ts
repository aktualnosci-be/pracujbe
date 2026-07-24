import { describe, expect, it, vi } from 'vitest';

import { claimWebhook, completeWebhook } from '@/lib/webhook-inbox';

/**
 * Testy inboxu webhooków ze stanem (P0-01/P0-02): duplikatem do pominięcia jest WYŁĄCZNIE wpis
 * `completed`. Awaria przed `completed` musi pozwolić na reprocessing (claim = 'claimed').
 *
 * Używamy lekkiego faka klienta Supabase odwzorowującego łańcuchy zapytań używane przez helper:
 *   insert(row)                  -> Promise<{ error }>
 *   select('status').eq().limit()-> Promise<{ data, error }>
 *   update(row).eq()             -> Promise<{ error }>
 */

type InsertResult = { error: unknown };
type SelectResult = { data: unknown; error: unknown };
type UpdateResult = { error: unknown };

interface Behaviors {
  insert?: (row: unknown) => InsertResult;
  select?: () => SelectResult;
  update?: (row: unknown) => UpdateResult;
}

function fakeAdmin(b: Behaviors) {
  const from = () => ({
    insert: (row: unknown) => Promise.resolve(b.insert ? b.insert(row) : { error: null }),
    select: () => ({
      eq: () => ({
        limit: () => Promise.resolve(b.select ? b.select() : { data: [], error: null }),
      }),
    }),
    update: (row: unknown) => ({
      eq: () => Promise.resolve(b.update ? b.update(row) : { error: null }),
    }),
  });
  return { from } as unknown as Parameters<typeof claimWebhook>[0];
}

describe('claimWebhook', () => {
  it("zwraca 'claimed' dla nowego zdarzenia (insert się udał)", async () => {
    const admin = fakeAdmin({ insert: () => ({ error: null }) });
    expect(await claimWebhook(admin, 'stripe:evt_1', 'stripe')).toBe('claimed');
  });

  it("zwraca 'duplicate' tylko gdy istniejący wpis jest 'completed'", async () => {
    const admin = fakeAdmin({
      insert: () => ({ error: { code: '23505' } }),
      select: () => ({ data: [{ status: 'completed' }], error: null }),
    });
    expect(await claimWebhook(admin, 'stripe:evt_1', 'stripe')).toBe('duplicate');
  });

  it("zwraca 'claimed' gdy istniejący wpis jest 'processing' (reprocessing po awarii)", async () => {
    const admin = fakeAdmin({
      insert: () => ({ error: { code: '23505' } }),
      select: () => ({ data: [{ status: 'processing' }], error: null }),
    });
    expect(await claimWebhook(admin, 'stripe:evt_1', 'stripe')).toBe('claimed');
  });

  it("zwraca 'error' gdy inbox jest nieosiągalny (insert nie-23505)", async () => {
    const admin = fakeAdmin({ insert: () => ({ error: { code: '08006', message: 'conn' } }) });
    expect(await claimWebhook(admin, 'stripe:evt_1', 'stripe')).toBe('error');
  });

  it("zwraca 'error' gdy select statusu po konflikcie zawodzi", async () => {
    const admin = fakeAdmin({
      insert: () => ({ error: { code: '23505' } }),
      select: () => ({ data: null, error: { message: 'boom' } }),
    });
    expect(await claimWebhook(admin, 'stripe:evt_1', 'stripe')).toBe('error');
  });
});

describe('completeWebhook', () => {
  it('oznacza wpis jako completed (update po id)', async () => {
    const update = vi.fn((_row: unknown) => ({ error: null }));
    const admin = fakeAdmin({ update });
    await completeWebhook(admin, 'stripe:evt_1');
    expect(update).toHaveBeenCalledOnce();
    expect((update.mock.calls[0]?.[0] as { status?: string }).status).toBe('completed');
  });
});

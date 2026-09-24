import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { normalizeResendEvent } from '@/lib/email/provider-events';
import { signStandardWebhook } from '@/lib/webhooks';

/**
 * #44 — webhook doręczeń Resend: weryfikacja podpisu (Svix / Standard Webhooks), świeżość
 * znacznika czasu, limit body, inbox anty-replay, mapowanie zdarzeń na model doręczeń
 * i fail-closed bez konfiguracji.
 */

const { adminRpc, captureError, prodMode } = vi.hoisted(() => ({
  adminRpc: vi.fn(),
  captureError: vi.fn(),
  prodMode: { value: true },
}));

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ rpc: adminRpc }) }));
vi.mock('@/lib/sentry', () => ({ captureError }));
vi.mock('@/lib/env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/env')>()),
  isProductionMode: () => prodMode.value,
  isSupabaseConfigured: () => process.env.TEST_SUPABASE !== 'off',
}));

const SECRET = `whsec_${Buffer.from('resend-webhook-test-key').toString('base64')}`;
const EVENT_ID = 'msg_2pZ9test';

function bounced(type = 'Permanent') {
  return {
    type: 'email.bounced',
    created_at: '2026-09-24T10:00:00.000Z',
    data: {
      email_id: 'provider-msg-1',
      to: ['Odbiorca@Example.com'],
      created_at: '2026-09-24T09:59:00.000Z',
      bounce: { message: 'mailbox does not exist', subType: 'General', type },
    },
  };
}

function signedRequest(
  body: string,
  opts: { secret?: string; ts?: number; id?: string; signature?: string } = {},
): Request {
  const ts = String(opts.ts ?? Math.floor(Date.now() / 1000));
  const id = opts.id ?? EVENT_ID;
  const signature = opts.signature ?? signStandardWebhook(opts.secret ?? SECRET, id, ts, body);
  return new Request('https://pracuj.be/api/email/webhook/resend', {
    method: 'POST',
    headers: { 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': signature },
    body,
  });
}

async function post(req: Request): Promise<Response> {
  const { POST } = await import('@/app/api/email/webhook/resend/route');
  return POST(req);
}

/** RPC: claim → wynik claimu; record → ok; complete → true. */
function mockRpc(claim: string = 'claimed', recordError: unknown = null, completed = true) {
  adminRpc.mockImplementation(async (fn: string) => {
    if (fn === 'claim_webhook') return { data: claim, error: null };
    if (fn === 'record_email_event') return { data: 'applied', error: recordError };
    if (fn === 'complete_webhook') return { data: completed, error: null };
    return { data: null, error: { message: 'unexpected rpc' } };
  });
}

function rpcCalls(fn: string) {
  return adminRpc.mock.calls.filter(([name]) => name === fn);
}

beforeEach(() => {
  vi.clearAllMocks();
  prodMode.value = true;
  process.env.RESEND_WEBHOOK_SECRET = SECRET;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
  delete process.env.TEST_SUPABASE;
  mockRpc();
});

describe('normalizeResendEvent — mapowanie zdarzeń', () => {
  it.each([
    ['email.delivered', 'delivered'],
    ['email.delivery_delayed', 'delivery_delayed'],
    ['email.complained', 'complained'],
  ])('%s → %s', (type, kind) => {
    const result = normalizeResendEvent({ type, created_at: '2026-09-24T10:00:00Z', data: { email_id: 'm1', to: ['a@b.be'] } });
    expect(result).toEqual({
      status: 'event',
      event: {
        provider: 'resend',
        kind,
        providerMessageId: 'm1',
        occurredAt: '2026-09-24T10:00:00.000Z',
        recipient: 'a@b.be',
        bounceType: null,
      },
    });
  });

  it('odbicie: typ Permanent/Transient, nieznany → undetermined', () => {
    const hard = normalizeResendEvent(bounced('Permanent'));
    expect(hard.status === 'event' && hard.event.bounceType).toBe('permanent');
    const soft = normalizeResendEvent(bounced('Transient'));
    expect(soft.status === 'event' && soft.event.bounceType).toBe('transient');
    const other = normalizeResendEvent(bounced('Whatever'));
    expect(other.status === 'event' && other.event.bounceType).toBe('undetermined');
  });

  it('zdarzenia spoza modelu są pomijane, nie udają doręczenia', () => {
    for (const type of ['email.sent', 'email.opened', 'email.clicked', 'email.failed', 'contact.created']) {
      expect(normalizeResendEvent({ type, data: { email_id: 'm1' } })).toEqual({ status: 'ignored' });
    }
  });

  it('brak stabilnego email_id albo zły kształt → invalid', () => {
    expect(normalizeResendEvent({ type: 'email.delivered', data: {} })).toEqual({ status: 'invalid' });
    expect(normalizeResendEvent({ type: 'email.delivered', data: { email_id: '  ' } })).toEqual({ status: 'invalid' });
    expect(normalizeResendEvent({ type: 'email.delivered', data: { email_id: 'x'.repeat(201) } })).toEqual({ status: 'invalid' });
    expect(normalizeResendEvent(null)).toEqual({ status: 'invalid' });
    expect(normalizeResendEvent([])).toEqual({ status: 'invalid' });
  });

  it('niepoprawny czas i adres → null (baza użyje now(), brak blokady spoza kolejki)', () => {
    const r = normalizeResendEvent({ type: 'email.complained', created_at: 'wczoraj', data: { email_id: 'm1', to: ['bez-malpy'] } });
    expect(r.status === 'event' && [r.event.occurredAt, r.event.recipient]).toEqual([null, null]);
  });
});

describe('POST /api/email/webhook/resend', () => {
  it('poprawny podpis Svix → zapis zdarzenia i zakończenie inboxu', async () => {
    const res = await post(signedRequest(JSON.stringify(bounced())));
    expect(res.status).toBe(200);
    expect(rpcCalls('claim_webhook')[0]?.[1]).toMatchObject({ p_id: `resend:${EVENT_ID}`, p_source: 'resend-email-events' });
    expect(rpcCalls('record_email_event')[0]?.[1]).toEqual({
      p_provider: 'resend',
      p_provider_message_id: 'provider-msg-1',
      p_event: 'bounced',
      p_occurred_at: '2026-09-24T10:00:00.000Z',
      p_recipient: 'Odbiorca@Example.com',
      p_bounce_type: 'permanent',
    });
    expect(rpcCalls('complete_webhook')).toHaveLength(1);
  });

  it('nagłówki webhook-* (Standard Webhooks) też są akceptowane', async () => {
    const body = JSON.stringify(bounced());
    const ts = String(Math.floor(Date.now() / 1000));
    const req = new Request('https://pracuj.be/api/email/webhook/resend', {
      method: 'POST',
      headers: {
        'webhook-id': EVENT_ID,
        'webhook-timestamp': ts,
        'webhook-signature': signStandardWebhook(SECRET, EVENT_ID, ts, body),
      },
      body,
    });
    expect((await post(req)).status).toBe(200);
  });

  it('KONTROLA UJEMNA: zły podpis, inny sekret, zmieniona treść → 401 bez zapisu', async () => {
    const body = JSON.stringify(bounced());
    const otherSecret = `whsec_${Buffer.from('inny-klucz').toString('base64')}`;
    expect((await post(signedRequest(body, { signature: 'v1,AAAA' }))).status).toBe(401);
    expect((await post(signedRequest(body, { secret: otherSecret }))).status).toBe(401);
    const ts = String(Math.floor(Date.now() / 1000));
    const tampered = new Request('https://pracuj.be/api/email/webhook/resend', {
      method: 'POST',
      headers: {
        'svix-id': EVENT_ID,
        'svix-timestamp': ts,
        'svix-signature': signStandardWebhook(SECRET, EVENT_ID, ts, body),
      },
      body: body.replace('Permanent', 'Transient'),
    });
    expect((await post(tampered)).status).toBe(401);
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it('KONTROLA UJEMNA: nieświeży znacznik czasu (replay starego żądania) → 401', async () => {
    const old = Math.floor(Date.now() / 1000) - 3600;
    expect((await post(signedRequest(JSON.stringify(bounced()), { ts: old }))).status).toBe(401);
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it('powtórzone zakończone zdarzenie (duplicate) i równoległa dostawa (locked) nie zmieniają stanu', async () => {
    mockRpc('duplicate');
    const dup = await post(signedRequest(JSON.stringify(bounced())));
    expect(dup.status).toBe(200);
    expect(await dup.json()).toMatchObject({ duplicate: true });
    mockRpc('locked');
    expect((await post(signedRequest(JSON.stringify(bounced())))).status).toBe(200);
    expect(rpcCalls('record_email_event')).toHaveLength(0);
  });

  it('błąd zapisu zdarzenia → 500 bez oznaczenia completed (dostawca ponowi)', async () => {
    mockRpc('claimed', { message: 'db down' });
    expect((await post(signedRequest(JSON.stringify(bounced())))).status).toBe(500);
    expect(rpcCalls('complete_webhook')).toHaveLength(0);
  });

  it('niedostępny inbox → 503, bez zapisu', async () => {
    mockRpc('error');
    expect((await post(signedRequest(JSON.stringify(bounced())))).status).toBe(503);
    expect(rpcCalls('record_email_event')).toHaveLength(0);
  });

  it('nieudane oznaczenie completed → 500', async () => {
    mockRpc('claimed', null, false);
    expect((await post(signedRequest(JSON.stringify(bounced())))).status).toBe(500);
  });

  it('zdarzenie spoza modelu → 200 bez inboxu i zapisu; zły JSON/kształt → 400', async () => {
    const opened = JSON.stringify({ type: 'email.opened', data: { email_id: 'm1' } });
    expect((await post(signedRequest(opened))).status).toBe(200);
    expect((await post(signedRequest('{nie-json'))).status).toBe(400);
    expect((await post(signedRequest(JSON.stringify({ type: 'email.delivered', data: {} })))).status).toBe(400);
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it('za duże body → 413 przed weryfikacją podpisu', async () => {
    const big = JSON.stringify({ ...bounced(), pad: 'x'.repeat(300_000) });
    expect((await post(signedRequest(big))).status).toBe(413);
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it('fail-closed: brak sekretu albo service-role → 503 (produkcja i poza nią), bez odczytu treści', async () => {
    delete process.env.RESEND_WEBHOOK_SECRET;
    expect((await post(signedRequest(JSON.stringify(bounced())))).status).toBe(503);
    expect(captureError).toHaveBeenCalledTimes(1);
    prodMode.value = false;
    expect((await post(signedRequest(JSON.stringify(bounced())))).status).toBe(503);
    process.env.RESEND_WEBHOOK_SECRET = SECRET;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect((await post(signedRequest(JSON.stringify(bounced())))).status).toBe(503);
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it('logi nie zawierają adresu odbiorcy ani treści zdarzenia', async () => {
    mockRpc('claimed', { message: 'db down for Odbiorca@Example.com' });
    await post(signedRequest(JSON.stringify(bounced())));
    const logged = JSON.stringify(captureError.mock.calls.map(([e, ctx]) => [String(e), ctx]));
    expect(logged).not.toMatch(/example\.com/i);
    expect(logged).not.toContain('mailbox does not exist');
  });
});

describe('kontrakt z migracją 0098', () => {
  const sql = readFileSync(join(process.cwd(), 'supabase/migrations/0098_email_delivery_events.sql'), 'utf8');

  it('record_email_event przyjmuje dokładnie rodzaje zdarzeń modelu', async () => {
    const { EMAIL_EVENT_KINDS } = await import('@/lib/email/provider-events');
    const match = sql.match(/p_event not in \(([^)]+)\)/);
    const kinds = (match?.[1] ?? '').split(',').map((s) => s.trim().replace(/'/g, ''));
    expect(kinds).toEqual([...EMAIL_EVENT_KINDS]);
  });

  it('parametry RPC w route = sygnatura funkcji', () => {
    const route = readFileSync(join(process.cwd(), 'src/app/api/email/webhook/resend/route.ts'), 'utf8');
    const params = [...route.matchAll(/(p_[a-z_]+):/g)].map((m) => m[1]).filter((p) => p !== 'p_id' && p !== 'p_source');
    const signature = sql.match(/function public\.record_email_event\(([\s\S]*?)\) returns/)?.[1] ?? '';
    const declared = [...signature.matchAll(/(p_[a-z_]+)/g)].map((m) => m[1]);
    expect(params).toEqual(declared);
  });
});

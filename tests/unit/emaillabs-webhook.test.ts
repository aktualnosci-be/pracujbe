import { beforeEach, describe, expect, it, vi } from 'vitest';

import { emailLabsChecksum, verifyEmailLabsWebhook } from '@/lib/email/emaillabs-webhook';
import { normalizeEmailLabsEvent } from '@/lib/email/provider-events';
import { fakeDb, pgError, resetFakeDb } from '../helpers/fake-db';

/**
 * Webhook raportów doręczeń EmailLabs: suma X-Webhook-Checksum (SHA1 sekret|data|Request-Id),
 * opcjonalny Basic auth, inbox `emaillabs:<Request-Id>`, mapowanie statusów na model #44,
 * trwałe odbicie → record_email_event (blokada adresu w bazie), fail-closed bez konfiguracji.
 */

const { captureError, prodMode } = vi.hoisted(() => ({
  captureError: vi.fn(),
  prodMode: { value: true },
}));

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/sentry', () => ({ captureError }));
vi.mock('@/lib/env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/env')>()),
  isProductionMode: () => prodMode.value,
}));

const SECRET = 'emaillabs-webhook-secret-test';
const DATE = '2026-09-25 09:00:00';
const REQUEST_ID = 'req-7f3a';
const MESSAGE_ID = '0a1b2c3d-0000-4000-8000-000000000001@pracuj.be';

function event(status: string, extra: Record<string, unknown> = {}) {
  return {
    subject: 'Nowa wiadomość',
    smtpAccount: '1.pracujbe.smtp',
    to: { email: 'Odbiorca@Example.com', name: '', messageId: MESSAGE_ID },
    from: { email: 'no-reply@pracuj.be', name: 'Pracuj.be' },
    tags: null,
    status,
    statusTime: 1_790_326_800,
    statusDesc: 'opis dostawcy',
    allStatuses: [],
    ...extra,
  };
}

function request(
  body: unknown,
  opts: { secret?: string; requestId?: string | null; checksum?: string; authorization?: string } = {},
): Request {
  const requestId = opts.requestId === undefined ? REQUEST_ID : opts.requestId;
  const headers: Record<string, string> = { 'x-webhook-date': DATE };
  if (requestId !== null) headers['request-id'] = requestId;
  headers['x-webhook-checksum'] = opts.checksum ??
    emailLabsChecksum(opts.secret ?? SECRET, DATE, requestId ?? '');
  if (opts.authorization) headers['authorization'] = opts.authorization;
  return new Request('https://pracuj.be/api/email/webhook/emaillabs', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function post(req: Request): Promise<Response> {
  const { POST } = await import('@/app/api/email/webhook/emaillabs/route');
  return POST(req);
}

function mockRpc(claim = 'claimed', recordError: string | null = null) {
  fakeDb.rpc('claim_webhook', claim);
  fakeDb.rpc('record_email_event', () => {
    if (recordError) throw pgError('XX000', recordError);
    return 'applied';
  });
  fakeDb.rpc('complete_webhook', true);
}

beforeEach(() => {
  vi.clearAllMocks();
  prodMode.value = true;
  process.env.EMAILLABS_WEBHOOK_SECRET = SECRET;
  delete process.env.EMAILLABS_WEBHOOK_BASIC_USER;
  delete process.env.EMAILLABS_WEBHOOK_BASIC_PASSWORD;
  resetFakeDb(null);
  mockRpc();
});

describe('normalizeEmailLabsEvent — mapowanie statusów', () => {
  it.each([
    ['ok', 'delivered', null],
    ['hardbounce', 'bounced', 'permanent'],
    ['softbounce', 'bounced', 'transient'],
    ['spambounce', 'bounced', 'undetermined'],
    ['deferred', 'delivery_delayed', null],
  ])('%s → %s (%s)', (status, kind, bounceType) => {
    expect(normalizeEmailLabsEvent(event(status))).toEqual({
      status: 'event',
      event: {
        provider: 'emaillabs',
        kind,
        providerMessageId: MESSAGE_ID,
        occurredAt: new Date(1_790_326_800 * 1000).toISOString(),
        recipient: 'Odbiorca@Example.com',
        bounceType,
      },
    });
  });

  it('injected / dropped / nieznany status nie udaje doręczenia', () => {
    for (const status of ['injected', 'dropped', 'opened']) {
      expect(normalizeEmailLabsEvent(event(status))).toEqual({ status: 'ignored' });
    }
  });

  it('brak messageId albo statusu = zdarzenie niepoprawne; nawiasy ostre są zdejmowane', () => {
    expect(normalizeEmailLabsEvent({ status: 'ok', to: { email: 'a@b.be' } })).toEqual({ status: 'invalid' });
    expect(normalizeEmailLabsEvent({ to: { messageId: 'x' } })).toEqual({ status: 'invalid' });
    const bracketed = normalizeEmailLabsEvent(event('ok', { to: { email: 'a@b.be', messageId: `<${MESSAGE_ID}>` } }));
    expect(bracketed.status === 'event' && bracketed.event.providerMessageId).toBe(MESSAGE_ID);
  });

  it('niepoprawny czas zdarzenia → null (baza użyje now())', () => {
    const result = normalizeEmailLabsEvent(event('ok', { statusTime: 'wczoraj' }));
    expect(result.status === 'event' && result.event.occurredAt).toBeNull();
  });
});

describe('verifyEmailLabsWebhook', () => {
  const headers = (checksum: string, authorization: string | null = null) => ({
    date: DATE, requestId: REQUEST_ID, checksum, authorization,
  });

  it('poprawna suma (także wielkimi literami) = zaufane; zły sekret / brak nagłówka = odrzucone', () => {
    const sum = emailLabsChecksum(SECRET, DATE, REQUEST_ID);
    expect(verifyEmailLabsWebhook({ secret: SECRET }, headers(sum))).toBe(true);
    expect(verifyEmailLabsWebhook({ secret: SECRET }, headers(sum.toUpperCase()))).toBe(true);
    expect(verifyEmailLabsWebhook({ secret: SECRET }, headers(emailLabsChecksum('inny', DATE, REQUEST_ID)))).toBe(false);
    expect(verifyEmailLabsWebhook({ secret: SECRET }, { ...headers(sum), requestId: null })).toBe(false);
    expect(verifyEmailLabsWebhook({ secret: SECRET }, headers('nie-hex'))).toBe(false);
  });

  it('suma wiąże Request-Id: podmiana identyfikatora przy tej samej sumie = odrzucone', () => {
    const sum = emailLabsChecksum(SECRET, DATE, REQUEST_ID);
    expect(verifyEmailLabsWebhook({ secret: SECRET }, { ...headers(sum), requestId: 'req-inne' })).toBe(false);
  });

  it('skonfigurowany Basic auth jest wymagany obok sumy', () => {
    const sum = emailLabsChecksum(SECRET, DATE, REQUEST_ID);
    const auth = { secret: SECRET, basicUser: 'el', basicPassword: 'haslo' };
    const good = `Basic ${Buffer.from('el:haslo').toString('base64')}`;
    const bad = `Basic ${Buffer.from('el:zle').toString('base64')}`;
    expect(verifyEmailLabsWebhook(auth, headers(sum, good))).toBe(true);
    expect(verifyEmailLabsWebhook(auth, headers(sum, bad))).toBe(false);
    expect(verifyEmailLabsWebhook(auth, headers(sum))).toBe(false);
    // Basic auth nie zastępuje sumy.
    expect(verifyEmailLabsWebhook(auth, headers('0'.repeat(40), good))).toBe(false);
  });
});

describe('POST /api/email/webhook/emaillabs', () => {
  it('brak sekretu → 503 bez przetwarzania (fail-closed) i sygnał w produkcji', async () => {
    delete process.env.EMAILLABS_WEBHOOK_SECRET;
    const res = await post(request([event('hardbounce')]));
    expect(res.status).toBe(503);
    expect(fakeDb.calls).toHaveLength(0);
    expect(captureError).toHaveBeenCalledOnce();
  });

  it('zła suma → 401, nic nie trafia do bazy', async () => {
    const res = await post(request([event('hardbounce')], { secret: 'podrobiony' }));
    expect(res.status).toBe(401);
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('brak Request-Id → 401 (bez klucza inboxu nie ma ochrony przed powtórzeniem)', async () => {
    const res = await post(request([event('ok')], { requestId: null }));
    expect(res.status).toBe(401);
  });

  it('trwałe odbicie → record_email_event (blokada adresu) i inbox emaillabs:<Request-Id>, 200 ok', async () => {
    const res = await post(request([event('hardbounce'), event('injected'), { junk: true }]));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
    expect(fakeDb.callsTo('claim_webhook')[0]?.args).toMatchObject({ p_id: `emaillabs:${REQUEST_ID}` });
    const records = fakeDb.callsTo('record_email_event');
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      as: 'service',
      args: {
        p_provider: 'emaillabs',
        p_provider_message_id: MESSAGE_ID,
        p_event: 'bounced',
        p_bounce_type: 'permanent',
        p_recipient: 'Odbiorca@Example.com',
      },
    });
    expect(fakeDb.callsTo('complete_webhook')).toHaveLength(1);
  });

  it('powtórzona paczka (ten sam Request-Id, już zakończona) → 200 bez ponownego zapisu', async () => {
    resetFakeDb(null);
    mockRpc('duplicate');
    const res = await post(request([event('hardbounce')]));
    expect(res.status).toBe(200);
    expect(fakeDb.callsTo('record_email_event')).toHaveLength(0);
  });

  it('błąd zapisu zdarzenia → 500 (EmailLabs ponowi), bez adresu w logu', async () => {
    resetFakeDb(null);
    mockRpc('claimed', 'insert failed for odbiorca@example.com');
    const res = await post(request([event('hardbounce')]));
    expect(res.status).toBe(500);
    expect(fakeDb.callsTo('complete_webhook')).toHaveLength(0);
    expect(JSON.stringify(captureError.mock.calls)).not.toContain('@');
  });

  it('nie-JSON → 400; pojedynczy obiekt (nie tablica) też jest przyjmowany', async () => {
    expect((await post(request('nie json'))).status).toBe(400);
    const res = await post(request(event('softbounce')));
    expect(res.status).toBe(200);
    expect(fakeDb.callsTo('record_email_event')[0]?.args).toMatchObject({ p_bounce_type: 'transient' });
  });
});

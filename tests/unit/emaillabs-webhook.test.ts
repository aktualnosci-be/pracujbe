import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  EMAILLABS_WEBHOOK_MAX_AGE_MS,
  emailLabsChecksum,
  isEmailLabsWebhookDateFresh,
  parseEmailLabsWebhookDate,
  verifyEmailLabsWebhook,
} from '@/lib/email/emaillabs-webhook';
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
vi.mock('@/lib/error-report', () => ({ captureError }));
vi.mock('@/lib/env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/env')>()),
  isProductionMode: () => prodMode.value,
}));

const SECRET = 'emaillabs-webhook-secret-test';
const DATE = '2026-09-25 09:00:00';
const REQUEST_ID = 'req-7f3a';
const MESSAGE_ID = '0a1b2c3d-0000-4000-8000-000000000001@pracuj.be';
/** „Teraz” w testach = chwila z `DATE` (czas bez strefy czytany jako UTC). */
const NOW = Date.UTC(2026, 8, 25, 9, 0, 0);
const BASIC_USER = 'el';
const BASIC_PASSWORD = 'haslo';
const GOOD_BASIC = `Basic ${Buffer.from(`${BASIC_USER}:${BASIC_PASSWORD}`).toString('base64')}`;

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
  opts: {
    secret?: string;
    requestId?: string | null;
    checksum?: string;
    authorization?: string | null;
    date?: string;
  } = {},
): Request {
  const requestId = opts.requestId === undefined ? REQUEST_ID : opts.requestId;
  const date = opts.date ?? DATE;
  const headers: Record<string, string> = { 'x-webhook-date': date };
  if (requestId !== null) headers['request-id'] = requestId;
  headers['x-webhook-checksum'] = opts.checksum ??
    emailLabsChecksum(opts.secret ?? SECRET, date, requestId ?? '');
  const authorization = opts.authorization === undefined ? GOOD_BASIC : opts.authorization;
  if (authorization) headers['authorization'] = authorization;
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
  process.env.EMAILLABS_WEBHOOK_BASIC_USER = BASIC_USER;
  process.env.EMAILLABS_WEBHOOK_BASIC_PASSWORD = BASIC_PASSWORD;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  resetFakeDb(null);
  mockRpc();
});

afterEach(() => {
  vi.useRealTimers();
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

describe('świeżość X-Webhook-Date (#1234)', () => {
  it('tolerancyjny parser: ISO, RFC 2822, czas bez strefy (UTC), epoka s/ms; śmieci = null', () => {
    expect(parseEmailLabsWebhookDate('2026-09-25 09:00:00')).toBe(NOW);
    expect(parseEmailLabsWebhookDate('2026-09-25T09:00:00')).toBe(NOW);
    expect(parseEmailLabsWebhookDate('2026-09-25T11:00:00+02:00')).toBe(NOW);
    expect(parseEmailLabsWebhookDate('Fri, 25 Sep 2026 09:00:00 GMT')).toBe(NOW);
    expect(parseEmailLabsWebhookDate(String(NOW / 1000))).toBe(NOW);
    expect(parseEmailLabsWebhookDate(String(NOW))).toBe(NOW);
    for (const bad of [null, '', 'wczoraj', '2026-02-31 10:00:00', '12:00', 'x'.repeat(300)]) {
      expect(parseEmailLabsWebhookDate(bad)).toBeNull();
    }
  });

  it('okno ±24 h: w oknie = świeże; starsze, dalsza przyszłość albo nieczytelne = nie', () => {
    expect(isEmailLabsWebhookDateFresh(DATE, NOW)).toBe(true);
    expect(isEmailLabsWebhookDateFresh(DATE, NOW + EMAILLABS_WEBHOOK_MAX_AGE_MS)).toBe(true);
    expect(isEmailLabsWebhookDateFresh(DATE, NOW + EMAILLABS_WEBHOOK_MAX_AGE_MS + 1000)).toBe(false);
    expect(isEmailLabsWebhookDateFresh(DATE, NOW - EMAILLABS_WEBHOOK_MAX_AGE_MS - 1000)).toBe(false);
    expect(isEmailLabsWebhookDateFresh('wczoraj', NOW)).toBe(false);
  });

  it('suma poprawna, ale data sprzed ponad doby → odrzucone (przechwycone nagłówki po GC inboxu)', () => {
    const sum = emailLabsChecksum(SECRET, DATE, REQUEST_ID);
    const headers = { date: DATE, requestId: REQUEST_ID, checksum: sum, authorization: null };
    expect(verifyEmailLabsWebhook({ secret: SECRET, now: NOW }, headers)).toBe(true);
    expect(verifyEmailLabsWebhook({ secret: SECRET, now: NOW + 31 * 24 * 3600 * 1000 }, headers)).toBe(false);
  });

  it('inbox pamięta Request-Id dłużej niż okno świeżości (minimum GC z migracji 0163)', async () => {
    const { readFileSync } = await import('node:fs');
    const sql = readFileSync('supabase/migrations/0163_maintenance_technical_gc.sql', 'utf8');
    const min = /greatest\(coalesce\(p_older_than_days, 30\), (\d+)\)/.exec(sql);
    expect(min).not.toBeNull();
    const minDaysMs = Number(min?.[1]) * 24 * 3600 * 1000;
    // Okno obejmuje przeszłość i przyszłość: podpisane żądanie jest ważne najwyżej 2 × okno.
    expect(minDaysMs).toBeGreaterThan(2 * EMAILLABS_WEBHOOK_MAX_AGE_MS);
  });

  it('requireBasic bez skonfigurowanego loginu = zawsze odrzucone (kontrola ujemna produkcji)', () => {
    const sum = emailLabsChecksum(SECRET, DATE, REQUEST_ID);
    const headers = { date: DATE, requestId: REQUEST_ID, checksum: sum, authorization: GOOD_BASIC };
    expect(verifyEmailLabsWebhook({ secret: SECRET, requireBasic: true }, headers)).toBe(false);
    expect(verifyEmailLabsWebhook({ secret: SECRET, requireBasic: false }, headers)).toBe(true);
  });
});

describe('POST /api/email/webhook/emaillabs', () => {
  it('produkcja bez Basic auth → 503 bez przetwarzania (#1234)', async () => {
    delete process.env.EMAILLABS_WEBHOOK_BASIC_PASSWORD;
    const res = await post(request([event('hardbounce')], { authorization: null }));
    expect(res.status).toBe(503);
    expect(fakeDb.calls).toHaveLength(0);
    expect(captureError).toHaveBeenCalledOnce();
  });

  it('poza produkcją bez Basic auth działa jak dotąd (kontrola ujemna trybu)', async () => {
    prodMode.value = false;
    delete process.env.EMAILLABS_WEBHOOK_BASIC_USER;
    delete process.env.EMAILLABS_WEBHOOK_BASIC_PASSWORD;
    const res = await post(request([event('ok')], { authorization: null }));
    expect(res.status).toBe(200);
  });

  it('produkcja: brak nagłówka Authorization → 401', async () => {
    const res = await post(request([event('hardbounce')], { authorization: null }));
    expect(res.status).toBe(401);
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('stara data z poprawną sumą → 401, nic nie trafia do bazy', async () => {
    const res = await post(request([event('hardbounce')], { date: '2026-08-01 09:00:00' }));
    expect(res.status).toBe(401);
    expect(fakeDb.calls).toHaveLength(0);
  });

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

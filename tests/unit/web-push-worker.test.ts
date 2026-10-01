// @vitest-environment node
import { createDecipheriv, createECDH, hkdfSync, randomBytes } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeDb, resetFakeDb } from '../helpers/fake-db';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

import { processPushQueue } from '@/lib/push/worker';
import { parseRetryAfter } from '@/lib/push/send';

/**
 * #724 — worker kolejki Web Push. Bez flagi/kluczy nie pobiera kolejki; 2xx = `sent`,
 * 404/410 = `gone` (urządzenie unieważnia baza), 429/5xx = `retry` z Retry-After, inne 4xx =
 * `failed`, błąd sieci = `retry`. Treść: tytuł/treść w języku ODBIORCY (z claimu), ścieżka
 * panelu, bez nazwy wyszukiwania. Endpoint spoza listy dozwolonych nie jest wołany wcale.
 */

function vapid() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const priv = Buffer.alloc(32);
  const raw = ecdh.getPrivateKey();
  raw.copy(priv, 32 - raw.length);
  return { publicKey: ecdh.getPublicKey('base64url'), privateKey: priv.toString('base64url') };
}

const keys = vapid();
const ENV = {
  WEB_PUSH_ENABLED: '1',
  WEB_PUSH_VAPID_PUBLIC_KEY: keys.publicKey,
  WEB_PUSH_VAPID_PRIVATE_KEY: keys.privateKey,
  WEB_PUSH_VAPID_SUBJECT: 'mailto:ops@example.com',
} as NodeJS.ProcessEnv;

const ua = createECDH('prime256v1');
ua.generateKeys();
const auth = randomBytes(16);

function claimRow(id: string, endpoint: string, locale = 'nl') {
  return {
    delivery_id: id,
    endpoint,
    p256dh: ua.getPublicKey('base64url'),
    auth_secret: auth.toString('base64url'),
    locale,
    entity_type: 'saved_search',
    entity_id: '11111111-1111-4111-8111-111111111111',
    job_count: 3,
    attempts: 1,
  };
}

function decrypt(body: Uint8Array): Record<string, string> {
  const buf = Buffer.from(body);
  const salt = buf.subarray(0, 16);
  const asPublic = buf.subarray(21, 86);
  const ct = buf.subarray(86);
  const secret = ua.computeSecret(asPublic);
  const ikm = Buffer.from(hkdfSync('sha256', secret, auth, Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPublic]), 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  return JSON.parse(plain.subarray(0, plain.length - 1).toString('utf8'));
}

beforeEach(() => {
  resetFakeDb(null);
  fakeDb.rpc('finish_push_delivery', true);
});

describe('worker Web Push', () => {
  it('kontrola ujemna: bez flagi albo kluczy — kolejka nie jest pobierana', async () => {
    const fetchImpl = vi.fn();
    expect(await processPushQueue({ env: {} as NodeJS.ProcessEnv, fetchImpl })).toEqual({ skipped: 'disabled' });
    expect(await processPushQueue({ env: { ...ENV, WEB_PUSH_VAPID_PRIVATE_KEY: '' }, fetchImpl })).toEqual({ skipped: 'disabled' });
    expect(fakeDb.callsTo('claim_push_deliveries')).toHaveLength(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('wysyła zaszyfrowane powiadomienie w języku odbiorcy i mapuje odpowiedzi usługi push', async () => {
    fakeDb.rpc('claim_push_deliveries', [
      claimRow('d-sent', 'https://fcm.googleapis.com/fcm/send/a1'),
      claimRow('d-gone', 'https://fcm.googleapis.com/fcm/send/a2'),
      claimRow('d-retry', 'https://updates.push.services.mozilla.com/wpush/v2/a3'),
      claimRow('d-fail', 'https://fcm.googleapis.com/fcm/send/a4'),
      claimRow('d-net', 'https://fcm.googleapis.com/fcm/send/a5'),
    ]);
    const statuses: Record<string, Response | Error> = {
      'https://fcm.googleapis.com/fcm/send/a1': new Response(null, { status: 201 }),
      'https://fcm.googleapis.com/fcm/send/a2': new Response(null, { status: 410 }),
      'https://updates.push.services.mozilla.com/wpush/v2/a3': new Response(null, { status: 503, headers: { 'Retry-After': '120' } }),
      'https://fcm.googleapis.com/fcm/send/a4': new Response(null, { status: 400 }),
      'https://fcm.googleapis.com/fcm/send/a5': new Error('ECONNRESET'),
    };
    const bodies: Uint8Array[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      bodies.push(init!.body as Uint8Array);
      const headers = init!.headers as Record<string, string>;
      expect(headers['Content-Encoding']).toBe('aes128gcm');
      expect(headers['Authorization']).toMatch(/^vapid t=.+, k=/);
      expect(init!.redirect).toBe('manual');
      const result = statuses[String(url)]!;
      if (result instanceof Error) throw result;
      return result;
    });

    const run = await processPushQueue({ env: ENV, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(run).toEqual({ claimed: 5, sent: 1, gone: 1, retried: 2, failed: 1 });
    const finish = Object.fromEntries(
      fakeDb.callsTo('finish_push_delivery').map((c) => [c.args['p_delivery_id'], [c.args['p_outcome'], c.args['p_error'], c.args['p_retry_after_seconds']]]),
    );
    expect(finish).toEqual({
      'd-sent': ['sent', null, null],
      'd-gone': ['gone', 'http_410', null],
      'd-retry': ['retry', 'http_503', 120],
      'd-fail': ['failed', 'http_400', null],
      'd-net': ['retry', 'network', null],
    });
    expect(fakeDb.callsTo('claim_push_deliveries')[0]!.as).toBe('service');

    // Treść: język odbiorcy (nl), ścieżka panelu, liczba ofert — bez nazwy wyszukiwania.
    const message = decrypt(bodies[0]!);
    expect(message).toEqual({
      title: 'Nieuwe vacatures uit je opgeslagen zoekopdracht',
      body: 'Nieuwe vacatures: 3. Bekijk ze in je account.',
      url: '/nl/candidate/wyszukiwania',
      tag: 'saved-search-alert',
    });
  });

  it('kontrola ujemna: endpoint spoza listy dozwolonych nie jest wołany (SSRF)', async () => {
    fakeDb.rpc('claim_push_deliveries', [claimRow('d-x', 'https://169.254.169.254/latest/meta-data')]);
    const fetchImpl = vi.fn();
    const run = await processPushQueue({ env: ENV, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(run).toMatchObject({ failed: 1 });
    expect(fakeDb.callsTo('finish_push_delivery')[0]!.args).toMatchObject({ p_outcome: 'failed', p_error: 'endpoint' });
  });

  it('nieobsługiwany język odbiorcy → angielski (fallback Invariant #1)', async () => {
    fakeDb.rpc('claim_push_deliveries', [{ ...claimRow('d-en', 'https://fcm.googleapis.com/fcm/send/b1', 'de'), job_count: null }]);
    const bodies: Uint8Array[] = [];
    await processPushQueue({
      env: ENV,
      fetchImpl: (async (_u: unknown, init?: RequestInit) => {
        bodies.push(init!.body as Uint8Array);
        return new Response(null, { status: 201 });
      }) as unknown as typeof fetch,
    });
    expect(decrypt(bodies[0]!)).toMatchObject({ url: '/en/candidate/wyszukiwania', body: 'There are new jobs matching your search.' });
  });

  it('Retry-After: sekundy, data HTTP, limit 6 h, nieczytelny = brak', () => {
    expect(parseRetryAfter('30')).toBe(30);
    expect(parseRetryAfter(new Date(1_000_000 + 90_000).toUTCString(), 1_000_000)).toBe(90);
    expect(parseRetryAfter('999999')).toBe(21_600);
    expect(parseRetryAfter('soon')).toBeNull();
    expect(parseRetryAfter(null)).toBeNull();
  });
});

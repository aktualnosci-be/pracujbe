// @vitest-environment node
import { createECDH } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeDb, fakeSession, pgError, resetFakeDb } from '../helpers/fake-db';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers({
    'user-agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36',
  })),
}));
vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(async () => true) }));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

import { registerPushDevice, revokePushDevice, unregisterPushDevice } from '@/lib/actions/push-devices';
import { checkRateLimit } from '@/lib/rate-limit';

/**
 * #724 — akcje urządzeń Web Push. Flaga wyłączona = `NOT_FOUND` bez bazy; endpoint spoza listy
 * dozwolonych / złe klucze = `VALIDATION_FAILED` bez bazy; tylko kandydat (pracodawca bez RPC);
 * etykieta urządzenia z User-Agent liczona na serwerze; limit urządzeń → `deviceLimit`.
 */

const CANDIDATE = '22222222-2222-4222-8222-222222222222';
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/device-1';
const P256 = 'B' + 'A'.repeat(86);
const AUTH = 'Q'.repeat(22);

function enablePush() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const priv = Buffer.alloc(32);
  const raw = ecdh.getPrivateKey();
  raw.copy(priv, 32 - raw.length);
  vi.stubEnv('WEB_PUSH_ENABLED', '1');
  vi.stubEnv('WEB_PUSH_VAPID_PUBLIC_KEY', ecdh.getPublicKey('base64url'));
  vi.stubEnv('WEB_PUSH_VAPID_PRIVATE_KEY', priv.toString('base64url'));
  vi.stubEnv('WEB_PUSH_VAPID_SUBJECT', 'mailto:ops@example.com');
}

beforeEach(() => {
  resetFakeDb({ id: CANDIDATE, role: 'candidate' });
  fakeDb
    .rpc('register_push_subscription', '33333333-3333-4333-8333-333333333333')
    .rpc('unregister_push_subscription', true)
    .rpc('revoke_push_subscription', true);
});
afterEach(() => vi.unstubAllEnvs());

describe('akcje urządzeń Web Push', () => {
  it('kontrola ujemna: flaga wyłączona (domyślnie) — NOT_FOUND bez bazy', async () => {
    vi.stubEnv('WEB_PUSH_ENABLED', '');
    const input = { endpoint: ENDPOINT, keys: { p256dh: P256, auth: AUTH } };
    expect(await registerPushDevice(input)).toEqual({ ok: false, error: 'NOT_FOUND' });
    expect(await unregisterPushDevice({ endpoint: ENDPOINT })).toEqual({ ok: false, error: 'NOT_FOUND' });
    expect(await revokePushDevice({ id: CANDIDATE })).toEqual({ ok: false, error: 'NOT_FOUND' });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('kandydat rejestruje urządzenie: RPC pod sesją, etykieta z User-Agent, limiter per konto', async () => {
    enablePush();
    expect(await registerPushDevice({ endpoint: ENDPOINT, keys: { p256dh: P256, auth: AUTH } })).toEqual({ ok: true });
    const [call] = fakeDb.callsTo('register_push_subscription');
    expect(call).toMatchObject({
      as: CANDIDATE,
      args: { p_endpoint: ENDPOINT, p_p256dh: P256, p_auth: AUTH, p_device_label: 'Chrome · Android' },
    });
    expect(vi.mocked(checkRateLimit)).toHaveBeenCalledWith('push-register', expect.objectContaining({ identifier: CANDIDATE, perIp: false }));
  });

  it.each([
    ['adres wewnętrzny', { endpoint: 'https://169.254.169.254/latest/meta-data', keys: { p256dh: P256, auth: AUTH } }],
    ['http', { endpoint: 'http://fcm.googleapis.com/fcm/send/device-1', keys: { p256dh: P256, auth: AUTH } }],
    ['zły klucz', { endpoint: ENDPOINT, keys: { p256dh: 'short', auth: AUTH } }],
    ['dodatkowe pole', { endpoint: ENDPOINT, keys: { p256dh: P256, auth: AUTH }, profileId: CANDIDATE }],
  ])('kontrola ujemna: %s → VALIDATION_FAILED bez bazy', async (_name, input) => {
    enablePush();
    expect(await registerPushDevice(input)).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('kontrola ujemna: pracodawca i gość bez RPC', async () => {
    enablePush();
    fakeSession.identity = { id: CANDIDATE, role: 'employer' };
    expect(await registerPushDevice({ endpoint: ENDPOINT, keys: { p256dh: P256, auth: AUTH } })).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    fakeSession.identity = null;
    expect(await unregisterPushDevice({ endpoint: ENDPOINT })).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('limit urządzeń z bazy → deviceLimit; limiter → RATE_LIMITED bez RPC', async () => {
    enablePush();
    fakeDb.rpc('register_push_subscription', () => {
      throw pgError('22023', 'PUSH_DEVICE_LIMIT');
    });
    expect(await registerPushDevice({ endpoint: ENDPOINT, keys: { p256dh: P256, auth: AUTH } }))
      .toEqual({ ok: false, error: 'VALIDATION_FAILED', reason: 'deviceLimit' });
    vi.mocked(checkRateLimit).mockResolvedValueOnce(false);
    resetFakeDb({ id: CANDIDATE, role: 'candidate' });
    expect(await registerPushDevice({ endpoint: ENDPOINT, keys: { p256dh: P256, auth: AUTH } })).toEqual({ ok: false, error: 'RATE_LIMITED' });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('wycofanie bieżącego i usunięcie urządzenia z listy; cudze urządzenie = NOT_FOUND', async () => {
    enablePush();
    expect(await unregisterPushDevice({ endpoint: ENDPOINT })).toEqual({ ok: true });
    expect(fakeDb.callsTo('unregister_push_subscription')[0]!.args).toEqual({ p_endpoint: ENDPOINT });
    expect(await revokePushDevice({ id: '33333333-3333-4333-8333-333333333333' })).toEqual({ ok: true });
    fakeDb.rpc('revoke_push_subscription', () => {
      throw pgError('P0002', 'NOT_FOUND');
    });
    expect(await revokePushDevice({ id: '44444444-4444-4444-8444-444444444444' })).toEqual({ ok: false, error: 'NOT_FOUND' });
    expect(await revokePushDevice({ id: 'not-a-uuid' })).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
  });
});

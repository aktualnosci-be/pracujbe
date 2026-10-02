// @vitest-environment node
import { createDecipheriv, createECDH, createPublicKey, hkdfSync, randomBytes, verify } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { encryptPushPayload, PushEncryptionError } from '@/lib/push/encrypt';
import { vapidAuthorization, VapidKeyError, vapidPrivateKey } from '@/lib/push/vapid';
import { isWebPushEnabled, webPushConfig, webPushPublicKey } from '@/lib/push/config';

/**
 * #724 — szyfrowanie Web Push (RFC 8291, aes128gcm) i VAPID (RFC 8292) na `node:crypto`.
 * Wektor z RFC 8291 Appendix A + odszyfrowanie niezależną implementacją strony przeglądarki;
 * kontrole ujemne: zły sekret `auth`, podmieniony podpis, niespójna para kluczy VAPID.
 */

const b64 = (value: string) => Buffer.from(value, 'base64url');

/** Strona przeglądarki (UA): odszyfrowanie jednego rekordu aes128gcm. */
function decrypt(body: Buffer, uaPrivate: Buffer, uaPublic: Buffer, auth: Buffer): string {
  const salt = body.subarray(0, 16);
  const idlen = body.readUInt8(20);
  const asPublic = body.subarray(21, 21 + idlen);
  const ciphertext = body.subarray(21 + idlen);
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(uaPrivate);
  const secret = ecdh.computeSecret(asPublic);
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', secret, auth, info, 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  const plain = Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - 16)), decipher.final()]);
  expect(plain[plain.length - 1]).toBe(0x02); // separator ostatniego rekordu
  return plain.subarray(0, plain.length - 1).toString('utf8');
}

describe('szyfrowanie Web Push (RFC 8291)', () => {
  it('wektor testowy RFC 8291 Appendix A', () => {
    const body = encryptPushPayload({
      p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
      auth: 'BTBZMqHH6r4Tts7J_aSIgg',
      plaintext: Buffer.from('When I grow up, I want to be a watermelon'),
      testing: { serverPrivateKey: b64('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'), salt: b64('DGv6ra1nlYgDCS1FRnbzlw') },
    });
    expect(body.toString('base64url')).toBe(
      'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
    );
  });

  it('przeglądarka odszyfrowuje wiadomość (nowa sól i klucz efemeryczny przy każdej wysyłce)', () => {
    const ua = createECDH('prime256v1');
    ua.generateKeys();
    const auth = randomBytes(16);
    const input = { p256dh: ua.getPublicKey('base64url'), auth: auth.toString('base64url'), plaintext: Buffer.from('{"title":"Nowe oferty"}') };
    const first = encryptPushPayload(input);
    const second = encryptPushPayload(input);
    expect(first.subarray(0, 16).equals(second.subarray(0, 16))).toBe(false);
    expect(first.readUInt32BE(16)).toBe(4096);
    expect(decrypt(first, ua.getPrivateKey(), ua.getPublicKey(), auth)).toBe('{"title":"Nowe oferty"}');
    // Kontrola ujemna: inny sekret `auth` (cudza subskrypcja) nie odszyfruje treści.
    expect(() => decrypt(first, ua.getPrivateKey(), ua.getPublicKey(), randomBytes(16))).toThrow();
  });

  it('kontrola ujemna: zły klucz klienta i za długa treść są odrzucane przed wysyłką', () => {
    expect(() => encryptPushPayload({ p256dh: 'AAAA', auth: 'BTBZMqHH6r4Tts7J_aSIgg', plaintext: Buffer.from('x') }))
      .toThrow(PushEncryptionError);
    const ua = createECDH('prime256v1');
    ua.generateKeys();
    expect(() =>
      encryptPushPayload({ p256dh: ua.getPublicKey('base64url'), auth: randomBytes(16).toString('base64url'), plaintext: Buffer.alloc(3001) }),
    ).toThrow(PushEncryptionError);
  });
});

function vapidPair() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const priv = Buffer.alloc(32);
  const raw = ecdh.getPrivateKey();
  raw.copy(priv, 32 - raw.length);
  return { publicKey: ecdh.getPublicKey('base64url'), privateKey: priv.toString('base64url') };
}

describe('VAPID (RFC 8292)', () => {
  it('JWT ES256: audience = origin usługi push, ważność 12 h, podpis weryfikowalny kluczem publicznym', () => {
    const keys = { ...vapidPair(), subject: 'mailto:ops@example.com' };
    const header = vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc?x=1', keys, 1_000_000);
    const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header);
    expect(match).not.toBeNull();
    const [, h, c, s, k] = match!;
    expect(k).toBe(keys.publicKey);
    expect(JSON.parse(b64(h!).toString())).toEqual({ typ: 'JWT', alg: 'ES256' });
    expect(JSON.parse(b64(c!).toString())).toEqual({ aud: 'https://fcm.googleapis.com', exp: 1_000_000 + 43_200, sub: 'mailto:ops@example.com' });
    const pub = b64(keys.publicKey);
    const key = createPublicKey({
      key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') },
      format: 'jwk',
    });
    expect(verify('sha256', Buffer.from(`${h}.${c}`), { key, dsaEncoding: 'ieee-p1363' }, b64(s!))).toBe(true);
    // Kontrola ujemna: zmieniona treść tokenu nie przechodzi weryfikacji.
    const forged = Buffer.from(JSON.stringify({ aud: 'https://evil.example', exp: 1, sub: 'x' })).toString('base64url');
    expect(verify('sha256', Buffer.from(`${h}.${forged}`), { key, dsaEncoding: 'ieee-p1363' }, b64(s!))).toBe(false);
  });

  it('kontrola ujemna: niespójna para kluczy jest odrzucana', () => {
    const a = vapidPair();
    const b = vapidPair();
    expect(() => vapidPrivateKey({ publicKey: a.publicKey, privateKey: b.privateKey })).toThrow(VapidKeyError);
    expect(() => vapidPrivateKey({ publicKey: a.publicKey, privateKey: 'short' })).toThrow(VapidKeyError);
  });
});

describe('konfiguracja Web Push (flaga + klucze ze zmiennych środowiska)', () => {
  const pair = vapidPair();
  const full = {
    WEB_PUSH_ENABLED: '1',
    WEB_PUSH_VAPID_PUBLIC_KEY: pair.publicKey,
    WEB_PUSH_VAPID_PRIVATE_KEY: pair.privateKey,
    WEB_PUSH_VAPID_SUBJECT: 'mailto:ops@example.com',
  } as unknown as NodeJS.ProcessEnv;

  it('komplet = włączona, klucz publiczny dla przeglądarki', () => {
    expect(isWebPushEnabled(full)).toBe(true);
    expect(webPushPublicKey(full)).toBe(pair.publicKey);
    expect(isWebPushEnabled({ ...full, WEB_PUSH_ENABLED: 'true' })).toBe(true);
  });

  it('kontrole ujemne: domyślnie wyłączona; brak klucza, zły subject albo para spoza kompletu = wyłączona', () => {
    expect(webPushConfig({} as NodeJS.ProcessEnv)).toBeNull();
    expect(webPushConfig({ ...full, WEB_PUSH_ENABLED: '' })).toBeNull();
    expect(webPushConfig({ ...full, WEB_PUSH_ENABLED: 'yes' })).toBeNull();
    expect(webPushConfig({ ...full, WEB_PUSH_VAPID_PRIVATE_KEY: '' })).toBeNull();
    expect(webPushConfig({ ...full, WEB_PUSH_VAPID_SUBJECT: 'ops@example.com' })).toBeNull();
    expect(webPushConfig({ ...full, WEB_PUSH_VAPID_PRIVATE_KEY: vapidPair().privateKey })).toBeNull();
  });
});

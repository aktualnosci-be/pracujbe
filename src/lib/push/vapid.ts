import { createECDH, createPrivateKey, sign, type JsonWebKey, type KeyObject } from 'node:crypto';

/**
 * VAPID (RFC 8292) dla Web Push (#724) na `node:crypto`: podpis JWT ES256 kluczem serwera.
 * Klucze wyłącznie ze zmiennych środowiska (`WEB_PUSH_VAPID_PUBLIC_KEY` — 65 B, base64url;
 * `WEB_PUSH_VAPID_PRIVATE_KEY` — 32 B, base64url). Nagłówek: `vapid t=<jwt>, k=<klucz publiczny>`.
 */

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  /** `mailto:` albo `https:` — kontakt dla usługi push (RFC 8292 §2.1). */
  subject: string;
}

export class VapidKeyError extends Error {
  constructor() {
    super('VAPID_KEYS_INVALID');
    this.name = 'VapidKeyError';
  }
}

function jwkFromKeys(keys: Pick<VapidKeys, 'publicKey' | 'privateKey'>): JsonWebKey {
  const pub = Buffer.from(keys.publicKey, 'base64url');
  const d = Buffer.from(keys.privateKey, 'base64url');
  if (pub.length !== 65 || pub[0] !== 0x04 || d.length !== 32) throw new VapidKeyError();
  return {
    kty: 'EC',
    crv: 'P-256',
    x: pub.subarray(1, 33).toString('base64url'),
    y: pub.subarray(33, 65).toString('base64url'),
    d: d.toString('base64url'),
  };
}

/** Klucz prywatny z pary; para niespójna (klucz publiczny nie pasuje do prywatnego) = błąd. */
export function vapidPrivateKey(keys: Pick<VapidKeys, 'publicKey' | 'privateKey'>): KeyObject {
  const jwk = jwkFromKeys(keys);
  try {
    // Spójność pary: klucz publiczny wyliczony z prywatnego = podany (KeyObject z JWK przyjąłby
    // niepasujące x/y bez błędu).
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(Buffer.from(keys.privateKey, 'base64url'));
    if (!ecdh.getPublicKey().equals(Buffer.from(keys.publicKey, 'base64url'))) throw new VapidKeyError();
    return createPrivateKey({ key: jwk, format: 'jwk' });
  } catch {
    throw new VapidKeyError();
  }
}

export function isValidVapidSubject(subject: string): boolean {
  return /^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/.test(subject) || /^https:\/\/[^\s]+$/.test(subject);
}

/** Nagłówek `Authorization` dla jednego żądania do usługi push (ważność 12 h, ≤ 24 h). */
export function vapidAuthorization(
  endpoint: string,
  keys: VapidKeys,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): string {
  const audience = new URL(endpoint).origin;
  const header = Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })).toString('base64url');
  const claims = Buffer.from(
    JSON.stringify({ aud: audience, exp: nowSeconds + 12 * 3600, sub: keys.subject }),
  ).toString('base64url');
  const signingInput = `${header}.${claims}`;
  const signature = sign('sha256', Buffer.from(signingInput), {
    key: vapidPrivateKey(keys),
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
  return `vapid t=${signingInput}.${signature}, k=${keys.publicKey}`;
}

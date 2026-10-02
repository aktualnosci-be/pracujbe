import { createCipheriv, createECDH, hkdfSync, randomBytes } from 'node:crypto';

/**
 * Szyfrowanie wiadomości Web Push (#724): RFC 8291 („Message Encryption for Web Push”)
 * z kodowaniem treści `aes128gcm` (RFC 8188), wyłącznie na `node:crypto` — bez pakietów npm.
 *
 * Dane: klucz publiczny klienta P-256 (`p256dh`, 65 B) i sekret uwierzytelniający (`auth`, 16 B)
 * z subskrypcji przeglądarki. Dla każdej wiadomości nowa efemeryczna para kluczy serwera i losowa
 * sól; jeden rekord (treść ≤ 3992 B), separator 0x02. Usługa push widzi wyłącznie szyfrogram.
 */

const RECORD_SIZE = 4096;
/** Najdłuższa treść jednego rekordu: 4096 − nagłówek 86 − tag 16 − separator 1 ≈ bezpiecznie 3000. */
export const PUSH_MAX_PLAINTEXT_BYTES = 3000;

export interface PushEncryptionInput {
  /** Klucz publiczny klienta (base64url, 65 B nieskompresowany punkt P-256). */
  p256dh: string;
  /** Sekret uwierzytelniający klienta (base64url, 16 B). */
  auth: string;
  plaintext: Uint8Array;
  /** Tylko testy (wektor RFC 8291): stała para efemeryczna i sól. */
  testing?: { serverPrivateKey: Buffer; salt: Buffer };
}

export class PushEncryptionError extends Error {
  constructor(readonly reason: 'keys' | 'size') {
    super(`PUSH_ENCRYPTION_${reason.toUpperCase()}`);
    this.name = 'PushEncryptionError';
  }
}

function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, length: number): Buffer {
  return Buffer.from(hkdfSync('sha256', ikm, salt, info, length));
}

export function encryptPushPayload(input: PushEncryptionInput): Buffer {
  const uaPublic = Buffer.from(input.p256dh, 'base64url');
  const authSecret = Buffer.from(input.auth, 'base64url');
  if (uaPublic.length !== 65 || uaPublic[0] !== 0x04 || authSecret.length !== 16) {
    throw new PushEncryptionError('keys');
  }
  if (input.plaintext.length > PUSH_MAX_PLAINTEXT_BYTES) throw new PushEncryptionError('size');

  const ecdh = createECDH('prime256v1');
  if (input.testing) ecdh.setPrivateKey(input.testing.serverPrivateKey);
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  let sharedSecret: Buffer;
  try {
    sharedSecret = ecdh.computeSecret(uaPublic);
  } catch {
    throw new PushEncryptionError('keys');
  }
  const salt = input.testing ? input.testing.salt : randomBytes(16);

  // RFC 8291 §3.3–3.4: IKM z sekretu ECDH i `auth`, potem klucz treści i nonce (RFC 8188).
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0', 'latin1'), uaPublic, asPublic]);
  const ikm = hkdf(authSecret, sharedSecret, keyInfo, 32);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0', 'latin1'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0', 'latin1'), 12);

  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([
    cipher.update(Buffer.concat([Buffer.from(input.plaintext), Buffer.from([0x02])])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  const header = Buffer.alloc(16 + 4 + 1);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, body]);
}

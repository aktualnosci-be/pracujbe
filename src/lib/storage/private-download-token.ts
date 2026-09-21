import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FORMAT = /^v1\.([0-9a-f-]{36})\.([0-9a-f-]{36})\.([1-9][0-9]{0,12})\.([A-Za-z0-9_-]{43})$/;
const MAX_TTL_SECONDS = 60;

export interface DownloadTokenOptions {
  secret: string;
  /** Unix time w milisekundach, jak Date.now. */
  now?: () => number;
}

function configuration({ secret, now = Date.now }: DownloadTokenOptions): { secret: string; timestamp: number } {
  if (typeof secret !== 'string' || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('Nieprawidłowy sekret podpisu pobrania.');
  }
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Nieprawidłowy czas podpisu pobrania.');
  return { secret, timestamp: Math.floor(value / 1000) };
}

function identity(fileId: string, userId: string): boolean {
  return typeof fileId === 'string' && typeof userId === 'string' && UUID.test(fileId) && UUID.test(userId);
}

function signature(payload: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(payload, 'utf8').digest();
}

/** Nazwy, ścieżki i adresy e-mail nie są częścią tokenu. Sekret musi być losowy. */
export function createPrivateDownloadToken(
  fileId: string,
  userId: string,
  options: DownloadTokenOptions & { ttlSeconds?: number },
): string {
  const { secret, timestamp } = configuration(options);
  const ttl = options.ttlSeconds ?? MAX_TTL_SECONDS;
  if (!identity(fileId, userId) || !Number.isInteger(ttl) || ttl < 1 || ttl > MAX_TTL_SECONDS) {
    throw new Error('Nieprawidłowe parametry podpisu pobrania.');
  }
  const payload = `v1.${fileId}.${userId}.${timestamp + ttl}`;
  return `${payload}.${signature(payload, secret).toString('base64url')}`;
}

/**
 * Podpis jest tylko dodatkowym warunkiem. Route MUSI ponownie sprawdzić aktualną
 * sesję, własność rekordu w DB, brak usunięcia i dopuszczony stan skanu.
 * expectedUserId pochodzi z potwierdzonej sesji serwera, nigdy z samego tokenu.
 */
export function verifyPrivateDownloadToken(
  token: string,
  expectedFileId: string,
  expectedUserId: string,
  options: DownloadTokenOptions,
): boolean {
  const { secret, timestamp } = configuration(options);
  if (typeof token !== 'string' || token.length > 135 || !identity(expectedFileId, expectedUserId)) return false;
  const match = FORMAT.exec(token);
  if (!match) return false;
  const [, fileId, userId, expiryText, encodedSignature] = match;
  if (!fileId || !userId || !expiryText || !encodedSignature || !identity(fileId, userId)) return false;
  if (fileId !== expectedFileId || userId !== expectedUserId) return false;
  const expiresAt = Number(expiryText);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= timestamp || expiresAt > timestamp + MAX_TTL_SECONDS) return false;
  const actual = Buffer.from(encodedSignature, 'base64url');
  // Odrzucamy również alternatywne kodowanie tych samych bajtów (bity dopełnienia).
  if (actual.length !== 32 || actual.toString('base64url') !== encodedSignature) return false;
  return timingSafeEqual(actual, signature(`v1.${fileId}.${userId}.${expiryText}`, secret));
}

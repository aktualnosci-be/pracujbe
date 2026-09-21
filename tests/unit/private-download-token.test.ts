import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createPrivateDownloadToken, verifyPrivateDownloadToken } from '@/lib/storage/private-download-token';

const file = '11111111-1111-4111-8111-111111111111';
const user = '22222222-2222-4222-8222-222222222222';
const other = '33333333-3333-4333-8333-333333333333';
const secret = 'test-secret-with-at-least-32-bytes!';
const time = 1_800_000_000_000;
const options = { secret, now: () => time };
const sign = (payload: string) => `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;

describe('Podpis prywatnego pobrania', () => {
  it('wiąże plik, użytkownika i 60 sekund ważności', () => {
    const token = createPrivateDownloadToken(file, user, options);
    expect(token.split('.').slice(0, 4)).toEqual(['v1', file, user, '1800000060']);
    expect(verifyPrivateDownloadToken(token, file, user, options)).toBe(true);
    expect(verifyPrivateDownloadToken(token, file, user, { ...options, now: () => time + 59_999 })).toBe(true);
    expect(verifyPrivateDownloadToken(token, file, user, { ...options, now: () => time + 60_000 })).toBe(false);
  });

  it('dopuszcza krótszy czas ważności', () => {
    const token = createPrivateDownloadToken(file, user, { ...options, ttlSeconds: 1 });
    expect(verifyPrivateDownloadToken(token, file, user, options)).toBe(true);
    expect(verifyPrivateDownloadToken(token, file, user, { ...options, now: () => time + 1_000 })).toBe(false);
  });

  it('odrzuca podmianę identyfikatorów, oczekiwanej sesji i podpisu', () => {
    const token = createPrivateDownloadToken(file, user, options);
    expect(verifyPrivateDownloadToken(token.replace(file, other), other, user, options)).toBe(false);
    expect(verifyPrivateDownloadToken(token.replace(user, other), file, other, options)).toBe(false);
    expect(verifyPrivateDownloadToken(token, other, user, options)).toBe(false);
    expect(verifyPrivateDownloadToken(token, file, other, options)).toBe(false);
    const parts = token.split('.');
    parts[4] = 'A'.repeat(43);
    expect(verifyPrivateDownloadToken(parts.join('.'), file, user, options)).toBe(false);
    expect(verifyPrivateDownloadToken(token, file, user, { ...options, secret: 'different-secret-at-least-32-bytes!' })).toBe(false);
  });

  it.each(['', 'v2.bad', ' '.repeat(200), '../secret', 'v1', '💾'])('odrzuca błędny format %j', token => {
    expect(verifyPrivateDownloadToken(token, file, user, options)).toBe(false);
  });

  it.each(['v2', 'V1'])('odrzuca nieobsługiwaną wersję %s mimo prawidłowego HMAC', version => {
    expect(verifyPrivateDownloadToken(sign(`${version}.${file}.${user}.1800000060`), file, user, options)).toBe(false);
  });

  it('odrzuca padding, dodatkowe pola i niekanoniczne bity podpisu', () => {
    const token = createPrivateDownloadToken(file, user, options);
    expect(verifyPrivateDownloadToken(`${token}=`, file, user, options)).toBe(false);
    expect(verifyPrivateDownloadToken(`${token}.extra`, file, user, options)).toBe(false);
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const last = alphabet.indexOf(token.at(-1)!);
    const alternative = token.slice(0, -1) + alphabet[last + 1];
    expect(Buffer.from(alternative.split('.')[4]!, 'base64url')).toEqual(Buffer.from(token.split('.')[4]!, 'base64url'));
    expect(verifyPrivateDownloadToken(alternative, file, user, options)).toBe(false);
  });

  it.each(['1800000061', '1800000000', '01799999999', '1800000000.5', '-1', 'NaN'])('odrzuca nieprawidłowy czas %s mimo prawidłowego HMAC', expiry => {
    expect(verifyPrivateDownloadToken(sign(`v1.${file}.${user}.${expiry}`), file, user, options)).toBe(false);
  });

  it.each([0, -1, 61, 1.5, NaN, Infinity])('nie wystawia tokenu dla TTL %s', ttlSeconds => {
    expect(() => createPrivateDownloadToken(file, user, { ...options, ttlSeconds })).toThrow();
  });

  it.each(['', 'a'.repeat(31)])('odmawia konfiguracji z krótkim sekretem', short => {
    expect(() => createPrivateDownloadToken(file, user, { ...options, secret: short })).toThrow('Nieprawidłowy sekret');
    expect(() => verifyPrivateDownloadToken('', file, user, { ...options, secret: short })).toThrow('Nieprawidłowy sekret');
  });

  it('mierzy długość sekretu w bajtach i waliduje UUID oraz zegar', () => {
    const unicode = { ...options, secret: 'ą'.repeat(16) };
    const token = createPrivateDownloadToken(file, user, unicode);
    expect(verifyPrivateDownloadToken(token, file, user, unicode)).toBe(true);
    expect(() => createPrivateDownloadToken('invalid', user, options)).toThrow();
    expect(() => createPrivateDownloadToken(file, 'invalid', options)).toThrow();
    expect(verifyPrivateDownloadToken(token, 'invalid', user, unicode)).toBe(false);
    expect(() => createPrivateDownloadToken(file, user, { ...options, now: () => NaN })).toThrow();
  });
});

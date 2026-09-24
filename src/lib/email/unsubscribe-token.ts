import { createHmac, timingSafeEqual } from 'node:crypto';

import { isEmailPreferenceCategory, type EmailPreferenceCategory } from './categories';

/**
 * Podpisany token wypisania z e-maili (#45).
 *
 * Format: `v1.<dane>.<podpis>` (base64url). Dane = `profil|kategoria|wygaśnięcie`, gdzie profil
 * to UUID konta — bez adresu e-mail, imienia ani innych danych osobowych w URL. Podpis =
 * HMAC-SHA256 z sekretem `EMAIL_UNSUBSCRIBE_SECRET` i prefiksem domeny, więc tokenu nie da się
 * pomylić z innym podpisem aplikacji. Weryfikacja w stałym czasie.
 *
 * Moduł bez `server-only`: używa go też test E2E do wygenerowania linku. Sekret zawsze
 * przychodzi z serwera (worker, route handler, akcja serwerowa).
 */

const VERSION = 'v1';
const DOMAIN = 'pracujbe:email-unsubscribe:v1';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Link z maila działa pół roku; potem strona kieruje do ustawień po zalogowaniu. */
export const UNSUBSCRIBE_TOKEN_TTL_SECONDS = 180 * 24 * 60 * 60;
export const UNSUBSCRIBE_SECRET_MIN_LENGTH = 32;
/** Twardy limit długości — odrzucamy śmieci przed dekodowaniem. */
const MAX_TOKEN_LENGTH = 256;

export type UnsubscribeTokenResult =
  | { ok: true; profileId: string; category: EmailPreferenceCategory; expiresAt: number }
  | { ok: false; reason: 'malformed' | 'signature' | 'expired' };

function sign(data: string, secret: string): string {
  return createHmac('sha256', secret).update(`${DOMAIN}.${data}`).digest('base64url');
}

function assertSecret(secret: string): void {
  if (typeof secret !== 'string' || secret.length < UNSUBSCRIBE_SECRET_MIN_LENGTH) {
    throw new Error('Sekret wypisania jest nieskonfigurowany lub za krótki.');
  }
}

/** Sekret z env albo `null`, gdy nieskonfigurowany (wtedy linki wypisania nie powstają). */
export function unsubscribeSecretFromEnv(): string | null {
  const value = process.env.EMAIL_UNSUBSCRIBE_SECRET;
  return value && value.length >= UNSUBSCRIBE_SECRET_MIN_LENGTH ? value : null;
}

export function createUnsubscribeToken(
  input: { profileId: string; category: EmailPreferenceCategory },
  secret: string,
  nowMs: number = Date.now(),
): string {
  assertSecret(secret);
  const profileId = input.profileId.toLowerCase();
  if (!UUID_RE.test(profileId) || !isEmailPreferenceCategory(input.category)) {
    throw new Error('Nieprawidłowe dane tokenu wypisania.');
  }
  const expiresAt = Math.floor(nowMs / 1000) + UNSUBSCRIBE_TOKEN_TTL_SECONDS;
  const data = Buffer.from(`${profileId}|${input.category}|${expiresAt}`, 'utf8').toString('base64url');
  return `${VERSION}.${data}.${sign(data, secret)}`;
}

export function verifyUnsubscribeToken(
  token: unknown,
  secret: string,
  nowMs: number = Date.now(),
): UnsubscribeTokenResult {
  assertSecret(secret);
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    return { ok: false, reason: 'malformed' };
  }
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== VERSION || !parts[1] || !parts[2]) {
    return { ok: false, reason: 'malformed' };
  }
  const [, data, signature] = parts as [string, string, string];

  const expected = Buffer.from(sign(data, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, reason: 'signature' };
  }

  const fields = Buffer.from(data, 'base64url').toString('utf8').split('|');
  if (fields.length !== 3) return { ok: false, reason: 'malformed' };
  const [profileId, category, exp] = fields as [string, string, string];
  const expiresAt = Number(exp);
  if (!UUID_RE.test(profileId) || !isEmailPreferenceCategory(category) ||
      !/^\d{1,12}$/.test(exp) || !Number.isSafeInteger(expiresAt)) {
    return { ok: false, reason: 'malformed' };
  }
  if (expiresAt * 1000 <= nowMs) return { ok: false, reason: 'expired' };
  return { ok: true, profileId, category, expiresAt };
}

/** Adres strony potwierdzenia (link HTML/tekstowy w mailu), w języku odbiorcy. */
export function unsubscribePageUrl(site: string, locale: string, token: string): string {
  return `${site}/${locale}/wypisz?t=${encodeURIComponent(token)}`;
}

/**
 * Adres one-click (RFC 8058) dla nagłówka `List-Unsubscribe`. `l` = język odbiorcy — tylko po
 * to, by zwykły GET (bez zmiany preferencji) przekierował na stronę w tym języku.
 */
export function unsubscribeOneClickUrl(site: string, locale: string, token: string): string {
  return `${site}/api/email/unsubscribe?t=${encodeURIComponent(token)}&l=${encodeURIComponent(locale)}`;
}

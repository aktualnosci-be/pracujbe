import { createHmac, timingSafeEqual } from 'node:crypto';

import { UNSUBSCRIBE_SECRET_MIN_LENGTH, UNSUBSCRIBE_TOKEN_TTL_SECONDS } from './unsubscribe-token';

/**
 * Podpisany token wyłączenia JEDNEGO alertu zapisanego wyszukiwania (e-mail `jobMatch`, #100).
 *
 * Format jak token wypisania (#45): `a1.<dane>.<podpis>` (base64url). Dane =
 * `profil|wyszukiwanie|wygaśnięcie` — dwa UUID, bez adresu e-mail, nazwy wyszukiwania ani
 * filtrów w URL. Podpis = HMAC-SHA256 z tym samym sekretem `EMAIL_UNSUBSCRIBE_SECRET`, ale
 * z INNYM prefiksem domeny i wersji, więc tokenu kategorii nie da się użyć jako tokenu alertu
 * (i odwrotnie). Weryfikacja w stałym czasie. Zapis dopiero po kliknięciu na stronie
 * `/{locale}/wypisz-alert` (RPC `saved_search_alert_unsubscribe`, tylko service_role).
 *
 * Moduł bez `server-only`: używa go test E2E do wygenerowania linku.
 */

const VERSION = 'a1';
const DOMAIN = 'pracujbe:saved-search-alert-off:v1';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Ważność jak link wypisania z kategorii. */
export const ALERT_OFF_TOKEN_TTL_SECONDS = UNSUBSCRIBE_TOKEN_TTL_SECONDS;
const MAX_TOKEN_LENGTH = 256;

export type AlertOffTokenResult =
  | { ok: true; profileId: string; savedSearchId: string; expiresAt: number }
  | { ok: false; reason: 'malformed' | 'signature' | 'expired' };

function sign(data: string, secret: string): string {
  return createHmac('sha256', secret).update(`${DOMAIN}.${data}`).digest('base64url');
}

function assertSecret(secret: string): void {
  if (typeof secret !== 'string' || secret.length < UNSUBSCRIBE_SECRET_MIN_LENGTH) {
    throw new Error('Sekret wypisania jest nieskonfigurowany lub za krótki.');
  }
}

export function createAlertOffToken(
  input: { profileId: string; savedSearchId: string },
  secret: string,
  nowMs: number = Date.now(),
): string {
  assertSecret(secret);
  const profileId = input.profileId.toLowerCase();
  const savedSearchId = input.savedSearchId.toLowerCase();
  if (!UUID_RE.test(profileId) || !UUID_RE.test(savedSearchId)) {
    throw new Error('Nieprawidłowe dane tokenu alertu.');
  }
  const expiresAt = Math.floor(nowMs / 1000) + ALERT_OFF_TOKEN_TTL_SECONDS;
  const data = Buffer.from(`${profileId}|${savedSearchId}|${expiresAt}`, 'utf8').toString('base64url');
  return `${VERSION}.${data}.${sign(data, secret)}`;
}

export function verifyAlertOffToken(
  token: unknown,
  secret: string,
  nowMs: number = Date.now(),
): AlertOffTokenResult {
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
  const [profileId, savedSearchId, exp] = fields as [string, string, string];
  const expiresAt = Number(exp);
  if (!UUID_RE.test(profileId) || !UUID_RE.test(savedSearchId) ||
      !/^\d{1,12}$/.test(exp) || !Number.isSafeInteger(expiresAt)) {
    return { ok: false, reason: 'malformed' };
  }
  if (expiresAt * 1000 <= nowMs) return { ok: false, reason: 'expired' };
  return { ok: true, profileId, savedSearchId, expiresAt };
}

/** Adres strony potwierdzenia w języku odbiorcy; token we fragmencie (nie trafia do HTTP). */
export function alertOffPageUrl(site: string, locale: string, token: string): string {
  return `${site}/${locale}/wypisz-alert#t=${encodeURIComponent(token)}`;
}

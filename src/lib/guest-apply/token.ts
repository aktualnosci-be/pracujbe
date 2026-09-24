import 'server-only';

import { createHash, createHmac, randomBytes } from 'node:crypto';

import { isProductionMode } from '@/lib/env';

/**
 * Tokeny jednorazowej aplikacji gościa (#98, migracja 0096).
 *
 * Baza przechowuje WYŁĄCZNIE `sha256(token)` (hex) i losowy `nonce`. Token nie jest nigdzie
 * zapisywany: to `HMAC-SHA256(GUEST_APPLY_SECRET, "<cel>:<nonce>")` w base64url, liczony
 * przez Server Action (przy zapisie zgłoszenia) i przez worker e-mail (przy renderze linku).
 * Sam odczyt bazy (nonce + hash) nie pozwala odtworzyć linku bez sekretu serwera.
 *
 * Cel (`confirm` / `claim`) jest częścią podpisu, więc token potwierdzenia nie działa jako
 * token przejęcia i odwrotnie.
 */

export type GuestTokenPurpose = 'confirm' | 'claim';

/** Sekret tylko poza produkcją, gdy GUEST_APPLY_SECRET nie ustawiono (dev/test/E2E). */
const DEV_FALLBACK_SECRET = 'pracujbe-dev-guest-apply-secret-not-for-production';
const MIN_SECRET_LENGTH = 32;
/** Token z linku: base64url z 32 bajtów HMAC = 43 znaki. */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** Sekret podpisu albo `null`, gdy w produkcji brakuje poprawnego GUEST_APPLY_SECRET. */
export function guestApplySecret(): string | null {
  const secret = process.env.GUEST_APPLY_SECRET ?? '';
  if (secret.length >= MIN_SECRET_LENGTH) return secret;
  return isProductionMode() ? null : DEV_FALLBACK_SECRET;
}

/** Czy aplikacja gościa może działać (sekret dostępny). */
export function isGuestTokenConfigured(): boolean {
  return guestApplySecret() !== null;
}

/** Token dla celu i nonce; `null` bez sekretu. */
export function guestTokenFromNonce(purpose: GuestTokenPurpose, nonce: string): string | null {
  const secret = guestApplySecret();
  if (!secret) return null;
  return createHmac('sha256', secret).update(`${purpose}:${nonce}`).digest('base64url');
}

/** Hash tokenu zapisywany i porównywany w bazie (hex, 64 znaki). */
export function hashGuestToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Czy wartość z adresu wygląda na token (odrzucamy śmieci przed zapytaniem do bazy). */
export function isGuestTokenFormat(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_RE.test(value);
}

/** Nowy nonce + hash tokenu do zapisu (token trafia do adresata wyłącznie e-mailem). */
export function issueGuestToken(purpose: GuestTokenPurpose): { nonce: string; hash: string } | null {
  const nonce = randomBytes(24).toString('base64url');
  const token = guestTokenFromNonce(purpose, nonce);
  if (!token) return null;
  return { nonce, hash: hashGuestToken(token) };
}

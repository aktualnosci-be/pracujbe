import 'server-only';

import { createHmac, randomBytes } from 'node:crypto';

import { guestApplySecret, hashGuestToken, isGuestTokenFormat } from '@/lib/guest-apply/token';

/**
 * Jednorazowy token linku rejestracji z zaproszenia do zespołu (#403, migracja 0121) —
 * ten sam schemat co aplikacja gościa (#98): baza trzyma WYŁĄCZNIE `sha256(token)` (hex),
 * a `nonce` jest tylko w payloadzie e-maila. Token = `HMAC-SHA256(sekret, "team-invite:<nonce>")`
 * w base64url, liczony przez akcję zaproszenia (hash do zapisu) i przez worker e-mail (link).
 *
 * Sekret: `GUEST_APPLY_SECRET` (poza produkcją stały sekret deweloperski). Cel `team-invite`
 * jest częścią podpisu, więc token zaproszenia nie działa jako token aplikacji gościa
 * (`confirm:` / `claim:`) i odwrotnie.
 */

const PURPOSE = 'team-invite';

/** Token z nonce; `null`, gdy w produkcji brakuje sekretu. */
export function teamInviteTokenFromNonce(nonce: string): string | null {
  const secret = guestApplySecret();
  if (!secret) return null;
  return createHmac('sha256', secret).update(`${PURPOSE}:${nonce}`).digest('base64url');
}

/** Hash tokenu zapisywany i porównywany w bazie (hex, 64 znaki). */
export function hashTeamInviteToken(token: string): string {
  return hashGuestToken(token);
}

/** Czy wartość z adresu wygląda na token (śmieci odrzucamy przed zapytaniem do bazy). */
export function isTeamInviteTokenFormat(value: unknown): value is string {
  return isGuestTokenFormat(value);
}

/** Nowy nonce + hash do zapisu; token trafia do adresata wyłącznie e-mailem. */
export function issueTeamInviteToken(): { nonce: string; hash: string } | null {
  const nonce = randomBytes(24).toString('base64url');
  const token = teamInviteTokenFromNonce(nonce);
  if (!token) return null;
  return { nonce, hash: hashTeamInviteToken(token) };
}

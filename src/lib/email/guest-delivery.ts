import 'server-only';

import { guestTokenFromNonce, type GuestTokenPurpose } from '@/lib/guest-apply/token';
import { teamInviteTokenFromNonce } from '@/lib/team/invite-token';

/**
 * Token do linku w e-mailu gościa (#98). Baza trzyma w payloadzie tylko `nonce`; token
 * odtwarzamy sekretem serwera (`@/lib/guest-apply/token`). Zaproszenie do zespołu dla adresu
 * bez konta (0109) — ten sam schemat, cel `team-invite`. Inne szablony → `undefined`.
 */
const PURPOSE: Record<string, GuestTokenPurpose> = {
  guestApplicationConfirm: 'confirm',
  guestApplicationSent: 'claim',
};

export function guestDeliveryToken(
  template: string,
  payload: Record<string, unknown> | null,
): string | null | undefined {
  const purpose = PURPOSE[template];
  if (!purpose && template !== 'teamInvitationSignup') return undefined;
  const nonce = payload?.['nonce'];
  if (typeof nonce !== 'string' || nonce.length < 16) return null;
  return purpose ? guestTokenFromNonce(purpose, nonce) : teamInviteTokenFromNonce(nonce);
}

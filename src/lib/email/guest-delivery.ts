import 'server-only';

import { guestTokenFromNonce, type GuestTokenPurpose } from '@/lib/guest-apply/token';

/**
 * Token do linku w e-mailu gościa (#98). Baza trzyma w payloadzie tylko `nonce`; token
 * odtwarzamy sekretem serwera (`@/lib/guest-apply/token`). Inne szablony → `undefined`.
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
  if (!purpose) return undefined;
  const nonce = payload?.['nonce'];
  if (typeof nonce !== 'string' || nonce.length < 16) return null;
  return guestTokenFromNonce(purpose, nonce);
}

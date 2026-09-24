'use server';

import { setGuestLinkToken } from '@/lib/guest-apply/link-cookie';
import type { GuestLinkPurpose } from '@/lib/guest-apply/link-state';

/** Stages a link from the URL fragment; does not confirm or claim an application. */
export async function stageGuestLink(
  locale: string,
  purpose: GuestLinkPurpose,
  token: string,
): Promise<boolean> {
  if (purpose !== 'confirm' && purpose !== 'claim') return false;
  return setGuestLinkToken(locale, purpose, token);
}

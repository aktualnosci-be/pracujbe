import 'server-only';

import { cookies } from 'next/headers';

import { isLocale } from '@/i18n/routing';
import {
  guestLinkCookieName,
  guestLinkMaxAge,
  guestLinkPath,
  isGuestLinkToken,
  type GuestLinkPurpose,
} from './link-state';

export async function readGuestLinkToken(purpose: GuestLinkPurpose): Promise<string | null> {
  const value = (await cookies()).get(guestLinkCookieName(purpose))?.value;
  return isGuestLinkToken(value) ? value : null;
}

export async function setGuestLinkToken(
  locale: string,
  purpose: GuestLinkPurpose,
  token: string,
): Promise<boolean> {
  if (!isLocale(locale) || !isGuestLinkToken(token)) return false;
  (await cookies()).set(guestLinkCookieName(purpose), token, {
    path: guestLinkPath(locale, purpose),
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: guestLinkMaxAge(purpose),
  });
  return true;
}

export async function clearGuestLinkToken(locale: string, purpose: GuestLinkPurpose): Promise<void> {
  if (!isLocale(locale)) return;
  (await cookies()).set(guestLinkCookieName(purpose), '', {
    path: guestLinkPath(locale, purpose),
    maxAge: 0,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  });
}

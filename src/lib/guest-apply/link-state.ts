/** Short-lived, HttpOnly handoff for links from guest application emails. */
import { isLocale } from '@/i18n/routing';

export type GuestLinkPurpose = 'confirm' | 'claim';

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function guestLinkCookieName(purpose: GuestLinkPurpose): string {
  return purpose === 'confirm' ? 'pb_guest_confirm' : 'pb_guest_claim';
}

export function guestLinkPath(locale: string, purpose: GuestLinkPurpose): string {
  return `/${locale}/aplikacja/${purpose === 'confirm' ? 'potwierdz' : 'przejmij'}`;
}

export function guestLinkPurpose(pathname: string): { locale: string; purpose: GuestLinkPurpose } | null {
  const match = /^\/([a-z]{2})\/aplikacja\/(potwierdz|przejmij)\/?$/.exec(pathname);
  if (!match || !isLocale(match[1])) return null;
  return { locale: match[1]!, purpose: match[2] === 'potwierdz' ? 'confirm' : 'claim' };
}

export function isGuestLinkToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_RE.test(value);
}

export function guestLinkMaxAge(purpose: GuestLinkPurpose): number {
  return purpose === 'confirm' ? 48 * 60 * 60 : 30 * 24 * 60 * 60;
}

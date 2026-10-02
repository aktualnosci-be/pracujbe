import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Znacznik przeglądarki, która założyła konto (#1090, AUTH-04).
 *
 * Automatyczne logowanie po kliknięciu linku potwierdzającego przysługuje tylko przeglądarce,
 * w której konto założono (albo w której podano poprawne hasło niepotwierdzonego konta — tam
 * też powstaje nowy link). Link otwarty gdzie indziej (inne urządzenie, cudza przeglądarka,
 * skaner poczty klikający przycisk) potwierdza adres, ale nie zostawia sesji — użytkownik
 * loguje się sam. Cookie HttpOnly niesie HMAC adresu (sekret Better Auth, osobna domena
 * podpisu), bez samego adresu; bez sekretu znacznik nie powstaje i nie pasuje.
 */
export const SIGNUP_BROWSER_COOKIE = 'pb_signup_browser';
/** Tyle co ważność linku potwierdzającego z zapasem (link ponawia logowanie niepotwierdzonego konta). */
export const SIGNUP_BROWSER_MAX_AGE = 60 * 60 * 24 * 7;

const DOMAIN = 'pracujbe:signup-browser:v1:';

/** Wartość znacznika dla adresu albo `null` bez sekretu. */
export function signupBrowserMarker(email: string, secret: string | undefined): string | null {
  if (!secret) return null;
  return createHmac('sha256', secret).update(`${DOMAIN}${email.trim().toLowerCase()}`).digest('base64url');
}

/** Czy cookie przeglądarki to znacznik TEGO adresu (porównanie w stałym czasie). */
export function isSignupBrowserFor(cookieValue: string | undefined, email: string, secret: string | undefined): boolean {
  const expected = signupBrowserMarker(email, secret);
  if (!expected || !cookieValue) return false;
  const a = Buffer.from(cookieValue);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

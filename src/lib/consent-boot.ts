import { CONSENT_COOKIE_NAME, CONSENT_POLICY_VERSION } from '@/lib/consent';
import { buildConsentBootScript } from '@/lib/security/csp-inline-scripts.mjs';

/**
 * Atrybut na <html>, który przed pierwszym malowaniem ukrywa baner zgód renderowany
 * w HTML serwera (#389). globals.css: `html[data-consent='set'] #cookie-banner { display: none }`.
 */
export const CONSENT_BOOT_ATTRIBUTE = 'data-consent';

/** Treść `<noscript>` w <head>: bez JS baner jest nieobsługiwalny, a trackery i tak się nie ładują. */
export const NOSCRIPT_HIDE_BANNER = '<style>#cookie-banner{display:none}</style>';

/**
 * Mały skrypt inline do `<head>` (#389). Baner cookies jest w HTML z serwera, więc maluje się
 * razem z FCP zamiast po hydratacji (wcześniej był elementem LCP po ~2 s). Skrypt działa przed
 * malowaniem <body>: gdy cookie zgody jest ważne (te same warunki co `getConsent()` —
 * poprawny JSON, `v`/`ts`/`id` jako tekst, obiekt `categories`, bieżąca wersja polityki),
 * ustawia `data-consent="set"` i baner nie mignie powracającemu użytkownikowi.
 *
 * Skrypt tylko CZYTA cookie — nic nie zapisuje i niczego nie ładuje (Invariant #7). O zgodzie
 * dalej decyduje `CookieConsent` po hydratacji (usuwa atrybut, gdy `getConsent()` go nie
 * potwierdzi). CSP (#585): egzekwowany `script-src` nadal ma `'unsafe-inline'` (wymagają go
 * wbudowane skrypty RSC Next.js); hash sha256 tego skryptu (`next.config.mjs` liczy go z tej
 * samej `buildConsentBootScript`) jest tylko w równoległym `Content-Security-Policy-Report-Only`.
 * Zmiana treści bez przeliczenia hasha dałaby fałszywe raporty (strażnik:
 * tests/unit/csp-inline-scripts.test.ts).
 */
export function consentBootScript(): string {
  return buildConsentBootScript({
    cookieName: CONSENT_COOKIE_NAME,
    policyVersion: CONSENT_POLICY_VERSION,
    attribute: CONSENT_BOOT_ATTRIBUTE,
  });
}

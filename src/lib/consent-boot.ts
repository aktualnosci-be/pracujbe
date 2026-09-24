import { CONSENT_COOKIE_NAME, CONSENT_POLICY_VERSION } from '@/lib/consent';

/**
 * Atrybut na <html>, który przed pierwszym malowaniem ukrywa baner zgód renderowany
 * w HTML serwera (#389). globals.css: `html[data-consent='set'] #cookie-banner { display: none }`.
 */
export const CONSENT_BOOT_ATTRIBUTE = 'data-consent';

/**
 * Mały skrypt inline do `<head>` (#389). Baner cookies jest w HTML z serwera, więc maluje się
 * razem z FCP zamiast po hydratacji (wcześniej był elementem LCP po ~2 s). Skrypt działa przed
 * malowaniem <body>: gdy cookie zgody jest ważne (te same warunki co `getConsent()` —
 * poprawny JSON, `v`/`ts`/`id` jako tekst, obiekt `categories`, bieżąca wersja polityki),
 * ustawia `data-consent="set"` i baner nie mignie powracającemu użytkownikowi.
 *
 * Skrypt tylko CZYTA cookie — nic nie zapisuje i niczego nie ładuje (Invariant #7). O zgodzie
 * dalej decyduje `CookieConsent` po hydratacji (usuwa atrybut, gdy `getConsent()` go nie
 * potwierdzi). CSP: `script-src` dopuszcza dziś `'unsafe-inline'`; przy przejściu na nonce
 * ten skrypt musi dostać nonce.
 */
export function consentBootScript(): string {
  const name = JSON.stringify(`${CONSENT_COOKIE_NAME}=`);
  const version = JSON.stringify(CONSENT_POLICY_VERSION);
  const attribute = JSON.stringify(CONSENT_BOOT_ATTRIBUTE);
  return (
    `(function(){try{var p=${name},c=document.cookie?document.cookie.split('; '):[];` +
    `for(var i=0;i<c.length;i++){if(c[i].indexOf(p)!==0)continue;` +
    `var r=JSON.parse(decodeURIComponent(c[i].slice(p.length)));` +
    `if(r&&typeof r==='object'&&r.v===${version}&&typeof r.ts==='string'&&typeof r.id==='string'` +
    `&&r.categories&&typeof r.categories==='object')` +
    `document.documentElement.setAttribute(${attribute},'set');return}}catch(e){}})();`
  );
}

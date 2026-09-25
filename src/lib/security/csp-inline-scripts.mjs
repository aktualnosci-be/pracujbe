// Treść inline'owych <script> dopuszczonych w produkcyjnym CSP wyłącznie hashem sha256,
// nigdy 'unsafe-inline' (#585). Czysta logika bez I/O — jedno źródło dla renderowanej strony
// (src/lib/consent-boot.ts, src/components/cookies/Analytics.tsx) i dla next.config.mjs, który
// liczy sha256 z DOKŁADNIE tego samego tekstu i wpisuje go do `script-src`. Zmiana treści
// skryptu bez przejścia przez te funkcje zepsułaby CSP w produkcji — strażnik:
// tests/unit/csp-inline-scripts.test.ts (porównuje hash z next.config z realnym renderem).

/**
 * @typedef {{ cookieName: string, policyVersion: string, attribute: string }} ConsentBootScriptInput
 */

/**
 * Skrypt w `<head>` (#389): przed pierwszym malowaniem ukrywa baner zgód, gdy w cookie jest
 * ważny zapis zgody (te same warunki co `getConsent()`). Skrypt tylko CZYTA cookie — nic nie
 * zapisuje i niczego nie ładuje (Invariant #7).
 * @param {ConsentBootScriptInput} input
 * @returns {string}
 */
export function buildConsentBootScript({ cookieName, policyVersion, attribute }) {
  const name = JSON.stringify(`${cookieName}=`);
  const version = JSON.stringify(policyVersion);
  const attr = JSON.stringify(attribute);
  return (
    `(function(){try{var p=${name},c=document.cookie?document.cookie.split('; '):[];` +
    `for(var i=0;i<c.length;i++){if(c[i].indexOf(p)!==0)continue;` +
    `var r=JSON.parse(decodeURIComponent(c[i].slice(p.length)));` +
    `if(r&&typeof r==='object'&&r.v===${version}&&typeof r.ts==='string'&&typeof r.id==='string'` +
    `&&r.categories&&typeof r.categories==='object')` +
    `document.documentElement.setAttribute(${attr},'set');return}}catch(e){}})();`
  );
}

/**
 * Inicjalizacja Google Analytics (gtag), renderowana dopiero po zgodzie na kategorię
 * `analytics` (Invariant #7, `Analytics.tsx`).
 * @param {string} gaId `NEXT_PUBLIC_GA_MEASUREMENT_ID`
 * @returns {string}
 */
export function buildGaInitScript(gaId) {
  return `window.dataLayer = window.dataLayer || [];function gtag(){dataLayer.push(arguments);}gtag('js', new Date());gtag('config', '${gaId}', { anonymize_ip: true });`;
}

/**
 * Inicjalizacja Meta Pixel, renderowana dopiero po zgodzie na kategorię `marketing`
 * (Invariant #7, `Analytics.tsx`).
 * @param {string} pixelId `NEXT_PUBLIC_META_PIXEL_ID`
 * @returns {string}
 */
export function buildMetaPixelScript(pixelId) {
  return `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${pixelId}');fbq('track','PageView');`;
}

// Treść inline'owych <script> dopuszczonych w produkcyjnym CSP wyłącznie hashem sha256,
// nigdy 'unsafe-inline' (#585). Czysta logika bez I/O — jedno źródło dla renderowanej strony
// (src/lib/consent-boot.ts) i dla next.config.mjs, który
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

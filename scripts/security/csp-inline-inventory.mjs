#!/usr/bin/env node
/**
 * Inwentarz inline skryptów i stylów pod wymuszającą politykę nonce/strict-dynamic (#585).
 *
 * Poza CI. Wymaga działającej aplikacji (`npm run build && npm run start`, tryb demo) i
 * Chromium (Playwright). Do KAŻDEJ odpowiedzi dokumentu dokłada nagłówek
 * `Content-Security-Policy-Report-Only` z polityką docelową (nonce nieznany aplikacji), więc
 * nic nie jest blokowane — przeglądarka tylko zgłasza zdarzenia `securitypolicyviolation`.
 * Polityka produkcyjna (`next.config.mjs`) się nie zmienia. Wynik nie zawiera treści skryptów
 * (tylko rodzaj, liczbę, bajty i liczbę różnych skrótów). Opis: docs/CSP_NONCE_ANALYSIS.md.
 *
 * Użycie: node scripts/security/csp-inline-inventory.mjs [--base http://localhost:3000] [--out plik.json]
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Polityka docelowa: nonce (nieznany aplikacji) + strict-dynamic, style tylko z własnego origin. */
export const TARGET_POLICY = [
  "script-src 'nonce-csp-inventory' 'strict-dynamic' 'report-sample'",
  "style-src 'self' 'nonce-csp-inventory' 'report-sample'",
].join('; ');

/** Trasy (tryb demo): publiczne, auth, panele — te same rodziny co bramki a11y w E2E. */
export const ROUTES = [
  '',
  '/oferty-pracy',
  '/oferty-pracy/bricklayer-brussels-1002',
  '/praca',
  '/praca/kategoria/construction',
  '/praca/miasto/brussels',
  '/poradniki',
  '/poradniki/praca-w-belgii-bez-znajomosci-jezyka',
  '/dla-pracodawcow',
  '/pomoc',
  '/kontakt',
  '/regulamin',
  '/polityka-cookies',
  '/logowanie',
  '/rejestracja',
  '/rejestracja-pracodawca',
  '/reset-hasla',
  '/offline',
  '/nie-istnieje',
  '/candidate',
  '/candidate/onboarding',
  '/candidate/wiadomosci',
  '/employer',
  '/employer/oferty/nowa',
  '/employer/statystyki',
  '/admin',
];

/** Rodzaj inline skryptu po typie i treści (treść nie trafia do wyniku). */
export function classifyScript(type, text) {
  const t = (type || '').toLowerCase();
  if (t && t !== 'text/javascript' && t !== 'application/javascript' && t !== 'module') {
    return t === 'application/ld+json' ? 'json-ld' : `data:${t}`;
  }
  if (text.includes('self.__next_f')) return 'next-rsc-payload';
  if (text.includes('pracujbe_consent')) return 'consent-boot';
  if (/\$R[CSTX]\b/.test(text)) return 'react-streaming';
  return 'other';
}

/**
 * Klucz naruszenia z komunikatu konsoli Chromium dla polityki Report-Only (zdarzenie
 * `securitypolicyviolation` bywa pomijane po pierwszej stronie kontekstu; konsola jest
 * pełna). Zwraca `dyrektywa cel`: cel = `inline` albo host zasobu (bez ścieżki i zapytania);
 * `null` dla komunikatów spoza CSP Report-Only.
 */
export function violationKey(message) {
  if (!message.includes('[Report Only]')) return null;
  const url = message.match(/Refused to load the (script|stylesheet) '([^']+)'/);
  if (url) {
    const directive = url[1] === 'script' ? 'script-src' : 'style-src';
    let host = url[2];
    try {
      host = new URL(url[2]).host;
    } catch {
      // zostaje surowa wartość (np. `data:`)
    }
    return `${directive} ${host}`;
  }
  if (/Refused to execute inline script/.test(message)) return 'script-src inline';
  if (/Refused to execute inline event handler/.test(message)) return 'script-src inline-handler';
  if (/Refused to apply inline style/.test(message)) return 'style-src inline';
  return 'other';
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : fallback;
  };
  const base = arg('--base', 'http://localhost:3000');
  const out = arg('--out', null);

  const { launchChromium } = await import('../lib/launch-chromium.mjs');
  const browser = await launchChromium();
  const context = await browser.newContext();
  await context.route('**/*', async (route) => {
    if (route.request().resourceType() !== 'document') return route.continue();
    const response = await route.fetch();
    return route.fulfill({
      response,
      headers: { ...response.headers(), 'content-security-policy-report-only': TARGET_POLICY },
    });
  });

  const report = [];
  for (const route of ROUTES) {
    const page = await context.newPage();
    const byViolation = {};
    page.on('console', (message) => {
      const key = violationKey(message.text());
      if (key) byViolation[key] = (byViolation[key] ?? 0) + 1;
    });
    await page.goto(`${base}/pl${route}`, { waitUntil: 'networkidle' }).catch(() => undefined);
    // Treść dokładana po hydratacji: zgoda na wszystko (beacon analityki), arkusz filtrów.
    const acceptAll = page.getByRole('button', { name: 'Akceptuj wszystkie', exact: true });
    if (await acceptAll.isVisible().catch(() => false)) {
      await acceptAll.click().catch(() => undefined);
      await page.waitForTimeout(800);
    }
    if (route === '/oferty-pracy') {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole('button', { name: /^Filtry/ }).first().click().catch(() => undefined);
      await page.waitForTimeout(500);
    }
    const dom = await page.evaluate(() => ({
      scripts: [...document.querySelectorAll('script:not([src])')].map((s) => ({
        type: s.getAttribute('type') || '',
        text: s.textContent || '',
      })),
      styleTags: document.querySelectorAll('style').length,
      styleAttrs: document.querySelectorAll('[style]').length,
      externalScriptHosts: [...new Set([...document.querySelectorAll('script[src]')].map((s) => new URL(s.src).host))],
    }));

    const scripts = {};
    for (const s of dom.scripts) {
      const kind = classifyScript(s.type, s.text);
      const entry = (scripts[kind] ??= { count: 0, bytes: 0, hashes: new Set() });
      entry.count += 1;
      entry.bytes += s.text.length;
      entry.hashes.add(createHash('sha256').update(s.text).digest('base64'));
    }
    report.push({
      route: `/pl${route}`,
      scripts: Object.fromEntries(
        Object.entries(scripts).map(([k, v]) => [k, { count: v.count, bytes: v.bytes, distinctHashes: v.hashes.size }]),
      ),
      styleTags: dom.styleTags,
      styleAttrs: dom.styleAttrs,
      externalScriptHosts: dom.externalScriptHosts,
      violations: byViolation,
    });
    await page.close();
  }
  await browser.close();

  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (out) writeFileSync(out, json);
  else process.stdout.write(json);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

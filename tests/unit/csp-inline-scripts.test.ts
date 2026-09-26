// @vitest-environment node
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

import config from '../../next.config.mjs';
import { buildConsentBootScript } from '@/lib/security/csp-inline-scripts.mjs';
import { consentBootScript } from '@/lib/consent-boot';
import { CONSENT_POLICY_VERSION } from '@/lib/consent-cookie';

/**
 * CSP script-src (#585). Znalezisko z realnego builda (`next build && next start`, Chromium):
 * Next.js App Router wstrzykuje własne inline `<script>` strumieniujące dane RSC
 * (`self.__next_f.push(...)`) na KAŻDEJ stronie, z treścią dynamiczną per strona/rewalidacja —
 * nie da się ich objąć stałą listą hashy w `next.config.mjs` (funkcja liczy się raz na proces).
 * Usunięcie `'unsafe-inline'` bez nonce blokuje te skrypty i psuje hydrację KAŻDEJ strony;
 * Next.js oficjalnie wspiera tylko nonce per-request przez middleware, a jego własna
 * dokumentacja mówi wprost, że to wyłącza ISR — sprzeczne z architekturą tego repo (#298).
 *
 * Dlatego enforced `script-src` ZOSTAJE z `'unsafe-inline'` (bez regresji — zweryfikowane
 * budową i Chromium). Równolegle produkcja dostaje `Content-Security-Policy-Report-Only` z tą
 * samą dyrektywą, ale hashem (bez `unsafe-inline`) dla skryptów, które kontrolujemy (baner zgód;
 * beacon Cloudflare Web Analytics #570 jest zewnętrzny, bez treści inline) — obserwowalny krok w stronę #585, nic nie blokujący.
 */

function sha256(text: string): string {
  return `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;
}

async function headersFor(env: Record<string, string>) {
  vi.stubEnv('NODE_ENV', 'production');
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  const rules = await config.headers!();
  return rules.find((rule) => rule.source === '/:path*')!.headers;
}

function directive(csp: string, name: string): string {
  return csp.split('; ').find((d) => d.startsWith(name))!;
}

afterEach(() => vi.unstubAllEnvs());

describe('script-src enforced w produkcji (#585) — bez regresji', () => {
  it('zostaje z unsafe-inline (Next.js App Router potrzebuje go do własnych skryptów RSC)', async () => {
    const headers = await headersFor({ APP_MODE: 'production', NEXT_PUBLIC_SITE_URL: 'https://pracuj.be' });
    const csp = headers.find((h) => h.key === 'Content-Security-Policy')!.value;
    const scriptSrc = directive(csp, 'script-src');
    expect(scriptSrc).toContain("'unsafe-inline'");
    expect(scriptSrc).toContain('https://challenges.cloudflare.com');
    expect(scriptSrc).not.toContain('googletagmanager');
    expect(scriptSrc).not.toContain('unsafe-eval');
  });
});

describe('script-src Report-Only (#585) — hashem, nie blokuje', () => {
  it('hash skryptu banera zgód, bez unsafe-inline', async () => {
    const headers = await headersFor({ APP_MODE: 'production', NEXT_PUBLIC_SITE_URL: 'https://pracuj.be' });
    const value = headers.find((h) => h.key === 'Content-Security-Policy-Report-Only')?.value;
    expect(value).toBeTruthy();
    const scriptSrc = directive(value!, 'script-src');
    expect(scriptSrc).not.toContain('unsafe-inline');
    expect(scriptSrc).toContain(sha256(consentBootScript()));
  });

  it('z tokenem Cloudflare Web Analytics: host beaconu, bez dodatkowego hasha (skrypt zewnętrzny)', async () => {
    const headers = await headersFor({
      APP_MODE: 'production',
      NEXT_PUBLIC_SITE_URL: 'https://pracuj.be',
      NEXT_PUBLIC_CF_WEB_ANALYTICS_TOKEN: 'test-token',
    });
    const value = headers.find((h) => h.key === 'Content-Security-Policy-Report-Only')!.value;
    const scriptSrc = directive(value, 'script-src');
    expect(scriptSrc).toContain('https://static.cloudflareinsights.com');
    expect(scriptSrc.match(/'sha256-/g)).toHaveLength(1);
  });

  it('kontrola ujemna: hash innej treści skryptu banera zgód NIE jest w Report-Only', async () => {
    const headers = await headersFor({ APP_MODE: 'production', NEXT_PUBLIC_SITE_URL: 'https://pracuj.be' });
    const value = headers.find((h) => h.key === 'Content-Security-Policy-Report-Only')!.value;
    const tampered = buildConsentBootScript({ cookieName: 'inny_cookie', policyVersion: '1.0', attribute: 'data-consent' });
    expect(value).not.toContain(sha256(tampered));
  });

  it('raportuje do osobnej grupy i adresu (osobne limity szumu, route.ts)', async () => {
    const headers = await headersFor({ APP_MODE: 'production', NEXT_PUBLIC_SITE_URL: 'https://pracuj.be' });
    const value = headers.find((h) => h.key === 'Content-Security-Policy-Report-Only')!.value;
    expect(value).toContain('report-uri /api/csp-report?policy=report-only');
    expect(value).toContain('report-to csp-report-only');
    const enforced = headers.find((h) => h.key === 'Content-Security-Policy')!.value;
    expect(enforced).toContain('report-to csp-endpoint');
    expect(enforced).not.toContain('policy=report-only');
    expect(headers.find((h) => h.key === 'Reporting-Endpoints')!.value).toBe(
      'csp-endpoint="/api/csp-report", csp-report-only="/api/csp-report?policy=report-only"',
    );
  });

  it('dev (NODE_ENV≠production): brak nagłówka Report-Only (nie zaśmieca lokalnego devu)', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const rules = await config.headers!();
    const headers = rules.find((rule) => rule.source === '/:path*')!.headers;
    expect(headers.some((h) => h.key === 'Content-Security-Policy-Report-Only')).toBe(false);
  });
});

describe('jedno źródło treści skryptu banera zgód', () => {
  it('consentBootScript() (komponent) zwraca dokładnie to, co next.config.mjs haszuje', () => {
    const fromComponent = consentBootScript();
    const fromSharedBuilder = buildConsentBootScript({
      cookieName: 'pracujbe_consent',
      policyVersion: CONSENT_POLICY_VERSION,
      attribute: 'data-consent',
    });
    expect(fromComponent).toBe(fromSharedBuilder);
  });
});

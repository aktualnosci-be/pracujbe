// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  ROUTES,
  TARGET_POLICY,
  classifyScript,
  violationKey,
} from '../../scripts/security/csp-inline-inventory.mjs';
import { consentBootScript } from '@/lib/consent-boot';

/** Pomiar do analizy CSP nonce/strict-dynamic (#585, docs/CSP_NONCE_ANALYSIS.md). */

describe('polityka docelowa pomiaru', () => {
  it('nonce + strict-dynamic, bez unsafe-inline (inaczej pomiar niczego nie wykryje)', () => {
    expect(TARGET_POLICY).toContain("'strict-dynamic'");
    expect(TARGET_POLICY).toMatch(/script-src [^;]*'nonce-/);
    expect(TARGET_POLICY).not.toContain('unsafe-inline');
    expect(TARGET_POLICY).not.toContain('unsafe-eval');
  });

  it('trasy obejmują strony publiczne, auth i każdy panel', () => {
    for (const route of ['', '/oferty-pracy', '/logowanie', '/candidate', '/employer', '/admin']) {
      expect(ROUTES).toContain(route);
    }
  });
});

describe('classifyScript', () => {
  it.each([
    ['application/ld+json', '{"@type":"JobPosting"}', 'json-ld'],
    ['', 'self.__next_f.push([1,"x"])', 'next-rsc-payload'],
    ['', consentBootScript(), 'consent-boot'],
    ['', '$RC("B:0","S:0")', 'react-streaming'],
    ['', 'requestAnimationFrame(function(){$RT=performance.now()});', 'react-streaming'],
    ['text/javascript', 'console.log(1)', 'other'],
    ['module', 'import "x"', 'other'],
    ['text/x-template', '<div></div>', 'data:text/x-template'],
  ])('typ %j → %s', (type, text, expected) => {
    expect(classifyScript(type, text)).toBe(expected);
  });
});

describe('violationKey (komunikaty konsoli Chromium, Report-Only)', () => {
  const policy = `"script-src 'nonce-csp-inventory' 'strict-dynamic' 'report-sample'"`;

  it('zewnętrzny skrypt → dyrektywa + host, bez ścieżki i zapytania', () => {
    expect(
      violationKey(
        `[Report Only] Refused to load the script 'http://localhost:3000/_next/static/chunks/webpack-1.js?x=1' because it violates the following Content Security Policy directive: ${policy}.`,
      ),
    ).toBe('script-src localhost:3000');
  });

  it('inline skrypt, handler i styl', () => {
    expect(violationKey(`[Report Only] Refused to execute inline script because it violates ${policy}.`)).toBe(
      'script-src inline',
    );
    expect(violationKey('[Report Only] Refused to execute inline event handler because …')).toBe(
      'script-src inline-handler',
    );
    expect(violationKey("[Report Only] Refused to apply inline style because it violates \"style-src 'self'\".")).toBe(
      'style-src inline',
    );
  });

  it('kontrola ujemna: komunikat wymuszający (bez Report-Only) i zwykły log nie są liczone', () => {
    expect(violationKey(`Refused to execute inline script because it violates ${policy}.`)).toBeNull();
    expect(violationKey('Download the React DevTools')).toBeNull();
  });
});

describe('docs/CSP_NONCE_ANALYSIS.md', () => {
  const doc = readFileSync(resolve(process.cwd(), 'docs', 'CSP_NONCE_ANALYSIS.md'), 'utf-8');

  it('wskazuje skrypt pomiaru i nie zmienia polityki produkcyjnej', () => {
    expect(doc).toContain('scripts/security/csp-inline-inventory.mjs');
    expect(doc).toContain('bez zmian polityki produkcyjnej');
  });

  it('pliki źródeł wymienione w analizie istnieją', () => {
    const paths = [...doc.matchAll(/`(src\/[^`\s]+\.(?:tsx?|mjs))`/g)].map((m) => m[1]!);
    expect(paths.length).toBeGreaterThan(3);
    for (const path of paths) {
      expect(() => readFileSync(resolve(process.cwd(), path)), path).not.toThrow();
    }
  });
});

describe('produkcyjna CSP bez zmian (analiza, nie wdrożenie)', () => {
  it('next.config.mjs dalej egzekwuje script-src z unsafe-inline', () => {
    const config = readFileSync(resolve(process.cwd(), 'next.config.mjs'), 'utf-8');
    const scriptSrc = config.match(/`script-src [^`]*`/)?.[0] ?? '';
    expect(scriptSrc).toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain('strict-dynamic');
    expect(scriptSrc).not.toContain('nonce-');
  });
});

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { routing } from '@/i18n/routing';

/**
 * #1057: middleware next-intl domyślnie dodaje nagłówek HTTP `Link` z alternatywami hreflang
 * (z `x-default` bez prefiksu języka), sprzeczny z hreflang w metadata i sitemapie. next-intl
 * nie ładuje się w Vitest (ESM `next/server`), więc prawdziwe middleware uruchamiamy w podprocesie
 * Node z małym hookiem rozwiązującym `next/server` → `next/server.js`, z KONFIGURACJĄ
 * `routing` z aplikacji (przekazaną jako JSON).
 */
const ROOT = process.cwd();

const CHILD = `
const create = require('next-intl/middleware').default;
const { NextRequest } = require('next/server');
const config = JSON.parse(process.env.ROUTING_JSON);
const mw = create(config);
const out = {};
for (const path of ['/pl/oferty-pracy/abc', '/nl', '/']) {
  const res = mw(new NextRequest('http://localhost:3000' + path));
  out[path] = res.headers.get('link');
}
process.stdout.write(JSON.stringify(out));
`;

const HOOK_SOURCE = `
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(
  "export async function resolve(s,c,n){ if(s==='next/server') s='next/server.js'; return n(s,c);}"
));
`;

function linkHeaders(config: object): Record<string, string | null> {
  const dir = mkdtempSync(join(tmpdir(), 'routing-alt-'));
  try {
    const hook = join(dir, 'hook.mjs');
    writeFileSync(hook, HOOK_SOURCE);
    const run = spawnSync(process.execPath, ['--import', pathToFileURL(hook).href, '-e', CHILD], {
      cwd: ROOT,
      env: { ...process.env, ROUTING_JSON: JSON.stringify(config) },
      encoding: 'utf8',
    });
    if (run.status !== 0) throw new Error(`podproces: ${run.stderr}`);
    return JSON.parse(run.stdout) as Record<string, string | null>;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('routing: bez nagłówka Link z hreflang (#1057)', () => {
  it('konfiguracja routingu wyłącza alternateLinks', () => {
    expect((routing as { alternateLinks?: boolean }).alternateLinks).toBe(false);
  });

  it('prawdziwe middleware next-intl z naszą konfiguracją nie ustawia nagłówka Link', () => {
    const headers = linkHeaders(routing);
    expect(headers).toEqual({ '/pl/oferty-pracy/abc': null, '/nl': null, '/': null });
  });

  it('kontrola ujemna: bez alternateLinks: false nagłówek Link z x-default jest dodawany', () => {
    const { alternateLinks: _omit, ...withoutFlag } = routing as typeof routing & { alternateLinks?: boolean };
    void _omit;
    const headers = linkHeaders(withoutFlag);
    expect(headers['/pl/oferty-pracy/abc']).toContain('hreflang="x-default"');
    expect(headers['/nl']).toContain('rel="alternate"');
  });
});

// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * #27 — brak czynnych zależności Supabase w kodzie runtime. Konta i sesje: Better Auth (#24),
 * dane paneli: PostgreSQL Railway (#25), pliki: bucket Railway (#26).
 *
 * Strażnik skanuje `src/` (i konfigurację Next.js) i odrzuca:
 * - import/`import()`/`require` pakietów `@supabase/*` oraz modułu `@/lib/supabase/*`,
 * - zmienne środowiska Supabase (`NEXT_PUBLIC_SUPABASE_*`, `SUPABASE_*`),
 * - hosty `*.supabase.co` w CSP i allowliście obrazów,
 * a w `package.json` — zależności `@supabase/*`.
 *
 * Wyjątki tylko jawnie, z uzasadnieniem (obecnie brak). Katalog `supabase/` (migracje SQL,
 * testy RLS) to zwykłe pliki SQL w repozytorium, nie zależność runtime — poza zakresem.
 */

const ROOT = process.cwd();

/** Jawna lista wyjątków: ścieżka względna → uzasadnienie. */
const EXCEPTIONS: Readonly<Record<string, string>> = {};

const RULES: ReadonlyArray<{ id: string; pattern: RegExp }> = [
  { id: 'sdk-import', pattern: /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]@supabase\//g },
  { id: 'client-module', pattern: /['"](?:@\/lib\/supabase|(?:\.\.?\/)+(?:lib\/)?supabase)\/[a-z-]+['"]/g },
  { id: 'env', pattern: /\b(?:NEXT_PUBLIC_SUPABASE_[A-Z_]+|SUPABASE_(?:SERVICE_ROLE_KEY|URL|ANON_KEY|DB_URL|JWT_SECRET))\b/g },
  { id: 'host', pattern: /supabase\.co\b/g },
];

/** Trafienia reguł w tekście pliku (id reguły + numer linii). */
export function supabaseFindings(source: string): string[] {
  const hits: string[] = [];
  for (const rule of RULES) {
    for (const match of source.matchAll(rule.pattern)) {
      const line = source.slice(0, match.index).split('\n').length;
      hits.push(`${rule.id}:${line}`);
    }
  }
  return hits;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(entry)) out.push(path);
  }
  return out;
}

describe('#27 brak Supabase w runtime', () => {
  it('src/ i next.config.mjs nie importują Supabase ani nie czytają jego konfiguracji', () => {
    const files = [...sourceFiles(join(ROOT, 'src')), join(ROOT, 'next.config.mjs'), join(ROOT, 'src/middleware.ts')];
    const offenders = files
      .map((file) => relative(ROOT, file))
      .filter((file) => !(file in EXCEPTIONS))
      .flatMap((file) => supabaseFindings(readFileSync(join(ROOT, file), 'utf8')).map((hit) => `${file} ${hit}`));
    expect(offenders).toEqual([]);
  });

  it('package.json nie deklaruje pakietów @supabase/*', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as Record<string, Record<string, string> | undefined>;
    const declared = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']
      .flatMap((field) => Object.keys(pkg[field] ?? {}));
    expect(declared.filter((name) => name.startsWith('@supabase/'))).toEqual([]);
  });

  it('wyjątki wskazują istniejące pliki i mają uzasadnienie', () => {
    for (const [file, reason] of Object.entries(EXCEPTIONS)) {
      expect(statSync(join(ROOT, file)).isFile(), file).toBe(true);
      expect(reason.trim().length, file).toBeGreaterThan(10);
    }
  });

  it('kontrola ujemna: każda forma zależności jest wykrywana', () => {
    const cases: Array<[string, string]> = [
      ["import { createClient } from '@supabase/supabase-js';", 'sdk-import'],
      ["const { createServerClient } = await import('@supabase/ssr');", 'sdk-import'],
      ["const sb = require('@supabase/supabase-js');", 'sdk-import'],
      ["import { createAdminClient } from '@/lib/supabase/admin';", 'client-module'],
      ["await import('../../lib/supabase/server')", 'client-module'],
      ['const url = process.env.NEXT_PUBLIC_SUPABASE_URL;', 'env'],
      ['const key = process.env.SUPABASE_SERVICE_ROLE_KEY;', 'env'],
      ["\"connect-src 'self' https://*.supabase.co\"", 'host'],
    ];
    for (const [source, rule] of cases) {
      expect(supabaseFindings(source).map((hit) => hit.split(':')[0]), source).toContain(rule);
    }
    // Katalog migracji i zwykłe słowo w komentarzu nie są zależnością.
    expect(supabaseFindings("readFileSync('supabase/migrations/0107_x.sql')")).toEqual([]);
    expect(supabaseFindings('// dawniej Supabase, teraz PostgreSQL Railway')).toEqual([]);
  });
});

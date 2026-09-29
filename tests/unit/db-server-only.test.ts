// @vitest-environment node
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * #1248 — Invariant #6: pule PostgreSQL (w tym `withServiceRole`, `DATABASE_SERVICE_URL`)
 * tylko na serwerze.
 *
 * 1. Każdy moduł `src/lib/db/*.ts` zaczyna się od `import 'server-only'` — build Next.js
 *    odrzuca wtedy każdy import z komponentu klienckiego.
 * 2. Graf importów od KAŻDEGO pliku `'use client'` w `src/` nie sięga `src/lib/db/**` ani
 *    sterownika `pg` (druga warstwa, niezależna od tego, czy ktoś usunie `server-only`).
 *    Moduły `'use server'` klient dostaje tylko jako referencję akcji — tam się zatrzymujemy
 *    (jak `public-bundle-no-zod.test.ts`).
 */

const ROOT = resolve(__dirname, '../..');
const SRC = join(ROOT, 'src');
const DB = join(SRC, 'lib', 'db');
const EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs'];
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** Pierwsza instrukcja modułu (po komentarzach) = `import 'server-only'`. */
function startsWithServerOnly(source: string): boolean {
  return /^\s*import\s+['"]server-only['"]\s*;?/.test(stripComments(source));
}

function resolveLocal(specifier: string, from: string): string | null {
  let base: string;
  if (specifier.startsWith('@/')) base = join(SRC, specifier.slice(2));
  else if (specifier.startsWith('.')) base = resolve(dirname(from), specifier);
  else return null;
  const candidates = [base, ...EXTENSIONS.map((ext) => base + ext), ...EXTENSIONS.map((ext) => join(base, `index${ext}`))];
  return candidates.find((path) => existsSync(path) && statSync(path).isFile()) ?? null;
}

/** Importy wartości (bez `import type`/`export type`), z re-eksportami i `import()`. */
function valueImports(source: string): string[] {
  const code = stripComments(source);
  const specifiers: string[] = [];
  for (const match of code.matchAll(/(?:^|[\n;])\s*(import|export)\s+(type\s+)?([^'";]*?)\s*from\s*['"]([^'"]+)['"]/g)) {
    if (!match[2]) specifiers.push(match[4]!);
  }
  for (const match of code.matchAll(/(?:^|[\n;])\s*import\s*['"]([^'"]+)['"]/g)) specifiers.push(match[1]!);
  for (const match of code.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) specifiers.push(match[1]!);
  return specifiers;
}

function directive(source: string): 'client' | 'server' | null {
  const head = source.replace(/^(\s|\/\/.*\n|\/\*[\s\S]*?\*\/)*/, '');
  if (/^['"]use client['"]/.test(head)) return 'client';
  if (/^['"]use server['"]/.test(head)) return 'server';
  return null;
}

const isDriver = (specifier: string) => specifier === 'pg' || specifier.startsWith('pg/') || specifier.startsWith('pg-');
const isDbModule = (file: string) => file === DB || file.startsWith(`${DB}/`);

/** Łańcuchy importów od pliku klienckiego do warstwy bazy (pusta lista = czysto). */
function clientDbChains(entries: readonly string[]): string[] {
  const seen = new Set<string>();
  const chains: string[] = [];
  const queue = entries.map((file) => ({ file, path: [file] }));
  const show = (path: string[]) => path.map((p) => relative(ROOT, p) || p).join(' → ');
  while (queue.length > 0) {
    const { file, path } = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    // Wejście = plik kliencki; dalej granica `'use server'` (tylko referencja akcji).
    if (path.length > 1 && directive(source) === 'server') continue;
    for (const specifier of valueImports(source)) {
      if (isDriver(specifier)) {
        chains.push(show([...path, specifier]));
        continue;
      }
      const target = resolveLocal(specifier, file);
      if (!target) continue;
      if (isDbModule(target)) {
        chains.push(show([...path, target]));
        continue;
      }
      queue.push({ file: target, path: [...path, target] });
    }
  }
  return chains;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(tsx?|mjs|js)$/.test(name)) out.push(path);
  }
  return out;
}

describe('#1248 — warstwa bazy tylko na serwerze (Invariant #6)', () => {
  const dbModules = readdirSync(DB).filter((name) => name.endsWith('.ts'));

  it('katalog src/lib/db ma moduły (strażnik nie jest pusty)', () => {
    expect(dbModules).toEqual(expect.arrayContaining(['pool.ts', 'portal.ts', 'service.ts']));
  });

  it.each(dbModules)("src/lib/db/%s zaczyna się od import 'server-only'", (name) => {
    expect(startsWithServerOnly(readFileSync(join(DB, name), 'utf8'))).toBe(true);
  });

  it('żaden plik `use client` w src/ nie sięga src/lib/db ani sterownika pg', () => {
    const clients = sourceFiles(SRC).filter((file) => directive(readFileSync(file, 'utf8')) === 'client');
    expect(clients.length).toBeGreaterThan(20);
    expect(clientDbChains(clients)).toEqual([]);
  });

  // Kontrole ujemne: detektory muszą łapać to, czego pilnują.
  it('wykrywa moduł bez server-only i z server-only po innej instrukcji (kontrola ujemna)', () => {
    const pool = readFileSync(join(DB, 'pool.ts'), 'utf8');
    expect(startsWithServerOnly(pool)).toBe(true);
    const stripped = pool.replace(/^\s*import\s+['"]server-only['"];?\s*$/m, '');
    expect(startsWithServerOnly(stripped)).toBe(false);
    expect(startsWithServerOnly(`import pg from 'pg';\nimport 'server-only';\n`)).toBe(false);
    expect(startsWithServerOnly(`/** opis */\n// komentarz\nimport "server-only";\n`)).toBe(true);
  });

  it('wykrywa komponent kliencki importujący warstwę bazy wprost i pośrednio (kontrola ujemna)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'db-server-only-'));
    dirs.push(dir);
    const direct = join(dir, 'Direct.tsx');
    writeFileSync(direct, `'use client';\nimport { withServiceRole } from '@/lib/db/portal';\nexport const x = withServiceRole;\n`);
    const helper = join(dir, 'helper.ts');
    writeFileSync(helper, `import pg from 'pg';\nexport const pool = pg;\n`);
    const indirect = join(dir, 'Indirect.tsx');
    writeFileSync(indirect, `"use client";\nimport { pool } from './helper';\nexport const y = pool;\n`);
    const typeOnly = join(dir, 'TypeOnly.tsx');
    writeFileSync(typeOnly, `'use client';\nimport type { PortalIdentity } from '@/lib/auth/session';\nexport type T = PortalIdentity;\n`);

    expect(clientDbChains([direct]).some((chain) => chain.includes('src/lib/db/portal.ts'))).toBe(true);
    expect(clientDbChains([indirect]).some((chain) => chain.endsWith('→ pg'))).toBe(true);
    expect(clientDbChains([typeOnly])).toEqual([]);
  });

  it('akcja serwerowa importowana z klienta nie jest wyciekiem (granica use server)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'db-server-only-'));
    dirs.push(dir);
    const client = join(dir, 'Form.tsx');
    writeFileSync(client, `'use client';\nimport { toggleSavedJob } from '@/lib/actions/candidate';\nexport const z = toggleSavedJob;\n`);
    const action = readFileSync(join(SRC, 'lib/actions/candidate.ts'), 'utf8');
    expect(directive(action)).toBe('server');
    expect(valueImports(action).some((specifier) => specifier.startsWith('@/lib/db/'))).toBe(true);
    expect(clientDbChains([client])).toEqual([]);
  });
});

// @vitest-environment node
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * #390: Zod (~15 KB gz) nie może wracać do bundla klienta stron publicznych bez formularzy.
 * Przyczyną była czysta funkcja URL (`loginHref`/`relocalizeNextParam`) importowana przez
 * komponenty klienckie z modułu, który na poziomie modułu buduje schematy Zoda.
 *
 * Test chodzi po grafie importów od plików trasy (layouty + strona). Kod serwerowy może używać
 * Zoda; do bundla przeglądarki trafia wszystko, co leży za granicą `'use client'`. Moduły
 * `'use server'` klient dostaje tylko jako referencję akcji, więc na nich zatrzymujemy się.
 * Zbudowany bundel sprawdza dodatkowo `scripts/check-next-build.mjs` (chunki z `ZodError`).
 */

const ROOT = resolve(__dirname, '../..');
const SRC = join(ROOT, 'src');
const APP = join(SRC, 'app');

const LAYOUTS = ['layout.tsx', '[locale]/layout.tsx', '[locale]/(public)/layout.tsx'];

/** Trasy publiczne bez formularzy — kryteria odbioru #390. */
const PUBLIC_ROUTES = [
  '[locale]/(public)/page.tsx',
  '[locale]/(public)/oferty-pracy/page.tsx',
  '[locale]/(public)/poradniki/page.tsx',
  '[locale]/(public)/poradniki/[slug]/page.tsx',
  '[locale]/(public)/praca/page.tsx',
];

const EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs'];

function isZod(specifier: string): boolean {
  return specifier === 'zod' || specifier.startsWith('zod/') || specifier === '@hookform/resolvers/zod';
}

function resolveLocal(specifier: string, from: string): string | null {
  let base: string;
  if (specifier.startsWith('@/')) base = join(SRC, specifier.slice(2));
  else if (specifier.startsWith('.')) base = resolve(dirname(from), specifier);
  else return null;
  const candidates = [
    base,
    ...EXTENSIONS.map((ext) => base + ext),
    ...EXTENSIONS.map((ext) => join(base, `index${ext}`)),
  ];
  return candidates.find((path) => existsSync(path) && statSync(path).isFile()) ?? null;
}

/** Importy wartości (bez `import type`/`export type`), łącznie z re-eksportami i `import()`. */
function valueImports(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const specifiers: string[] = [];
  const statement = /(?:^|[\n;])\s*(import|export)\s+(type\s+)?([^'";]*?)\s*from\s*['"]([^'"]+)['"]/g;
  for (const match of code.matchAll(statement)) {
    if (match[2]) continue;
    specifiers.push(match[4]!);
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

/** Łańcuchy importów od granicy klienta do Zoda (pusta lista = czysto). */
function clientZodChains(entries: readonly string[]): string[] {
  const seen = new Set<string>();
  const chains: string[] = [];
  const queue: { file: string; client: boolean; path: string[] }[] = entries.map((file) => ({
    file,
    client: false,
    path: [file],
  }));
  while (queue.length > 0) {
    const { file, client: parentClient, path } = queue.shift()!;
    const source = readFileSync(file, 'utf8');
    const kind = directive(source);
    if (kind === 'server' && parentClient) continue;
    const client = parentClient || kind === 'client';
    const key = `${client}:${file}`;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const specifier of valueImports(source)) {
      if (isZod(specifier)) {
        if (client) chains.push([...path, specifier].map((p) => relative(ROOT, p) || p).join(' → '));
        continue;
      }
      const target = resolveLocal(specifier, file);
      if (target) queue.push({ file: target, client, path: [...path, target] });
    }
  }
  return chains;
}

describe('#390 — Zod poza bundlem klienta stron publicznych', () => {
  it.each(PUBLIC_ROUTES)('%s: komponenty klienckie nie importują Zoda', (route) => {
    const entries = [...LAYOUTS, route].map((file) => join(APP, file));
    for (const entry of entries) expect(existsSync(entry), entry).toBe(true);
    expect(clientZodChains(entries)).toEqual([]);
  });

  it('helpery adresu next nie importują Zoda ani schematów walidacji', () => {
    const source = readFileSync(join(SRC, 'lib/auth/next-path.ts'), 'utf8');
    const imports = valueImports(source);
    expect(imports.filter(isZod)).toEqual([]);
    expect(imports.some((specifier) => specifier.includes('validation/'))).toBe(false);
  });

  // Kontrola ujemna: analiza musi wykrywać Zoda za granicą 'use client' (formularz logowania).
  it('wykrywa Zoda w komponencie klienckim formularza auth (kontrola ujemna)', () => {
    const chains = clientZodChains([join(APP, '[locale]/(auth)/logowanie/page.tsx')]);
    expect(chains.length).toBeGreaterThan(0);
    expect(chains.some((chain) => chain.includes('src/lib/validation/auth.ts'))).toBe(true);
  });

  it('nie zgłasza Zoda używanego wyłącznie po stronie serwera (kontrola ujemna)', () => {
    // Akcje serwerowe (`'use server'`) importują schematy Zoda, ale klient dostaje tylko referencję.
    const actions = join(SRC, 'lib/actions/auth.ts');
    expect(valueImports(readFileSync(actions, 'utf8')).some((s) => s.includes('validation/auth'))).toBe(true);
    expect(clientZodChains([actions])).toEqual([]);
  });
});

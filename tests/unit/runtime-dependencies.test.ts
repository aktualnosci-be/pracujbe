// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * #1121 — kod runtime (`src/`) nie może zależeć od pakietów zadeklarowanych jako
 * `devDependencies`. Przycięcie zależności produkcyjnych (`npm ci --omit=dev`) po cichu
 * wyłączyłoby np. render e-maili, choć build i CI (z devDependencies) przechodzą.
 *
 * Drugi strażnik: `package-lock.json` nie oznacza `"dev": true` pakietu, który jest
 * osiągalny z `dependencies` (ręczna zmiana package.json bez spójnego lockfile).
 */

const ROOT = process.cwd();

type Manifest = { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
type LockPackage = {
  dev?: boolean;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
};

const IMPORT_RE = /(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)['"]([^'"]+)['"]/g;

/** Nazwa pakietu z określnika modułu (`@scope/pkg/sub` → `@scope/pkg`); null dla ścieżek i wbudowanych. */
export function packageNameOf(specifier: string): string | null {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('@/')) return null;
  if (specifier.startsWith('node:')) return null;
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
}

/** Pakiety z devDependencies (i tylko z nich) importowane w podanym źródle. */
export function devOnlyImports(source: string, manifest: Manifest): string[] {
  const dependencies = manifest.dependencies ?? {};
  const devDependencies = manifest.devDependencies ?? {};
  const found = new Set<string>();
  for (const match of source.matchAll(IMPORT_RE)) {
    const name = packageNameOf(match[1]!);
    if (name && name in devDependencies && !(name in dependencies)) found.add(name);
  }
  return [...found].sort();
}

/** Klucze lockfile oznaczone `dev`, a osiągalne z `dependencies` głównego pakietu. */
export function devFlaggedButProductionReachable(
  packages: Record<string, LockPackage>,
  productionRoots: string[],
): string[] {
  const resolve = (from: string, name: string): string | null => {
    let base = from;
    for (;;) {
      const candidate = `${base ? `${base}/` : ''}node_modules/${name}`;
      if (candidate in packages) return candidate;
      if (!base) return null;
      const cut = base.lastIndexOf('/node_modules/');
      base = cut >= 0 ? base.slice(0, cut) : '';
    }
  };
  const seen = new Set<string>();
  const stack = productionRoots.map((name) => resolve('', name)).filter((key): key is string => key !== null);
  while (stack.length > 0) {
    const key = stack.pop()!;
    if (seen.has(key)) continue;
    seen.add(key);
    const entry = packages[key]!;
    const edges: Record<string, string> = { ...entry.dependencies, ...entry.optionalDependencies };
    for (const name of Object.keys(entry.peerDependencies ?? {})) {
      if (!entry.peerDependenciesMeta?.[name]?.optional) edges[name] = '*';
    }
    for (const name of Object.keys(edges)) {
      const next = resolve(key, name);
      if (next) stack.push(next);
    }
  }
  return [...seen].filter((key) => packages[key]!.dev === true).sort();
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(?:ts|tsx|mjs|js)$/.test(entry)) out.push(full);
  }
  return out;
}

describe('#1121 zależności runtime', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as Manifest;

  it('szablony e-mail używają pakietów z dependencies', () => {
    expect(Object.keys(manifest.dependencies ?? {})).toEqual(
      expect.arrayContaining(['@react-email/components', '@react-email/render']),
    );
    expect(Object.keys(manifest.devDependencies ?? {})).not.toContain('@react-email/components');
    expect(Object.keys(manifest.devDependencies ?? {})).not.toContain('@react-email/render');
  });

  it('żaden plik w src/ nie importuje pakietu tylko z devDependencies', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join(ROOT, 'src'))) {
      const dev = devOnlyImports(readFileSync(file, 'utf8'), manifest);
      if (dev.length > 0) offenders.push(`${file.slice(ROOT.length + 1)}: ${dev.join(', ')}`);
    }
    expect(offenders).toEqual([]);
  });

  it('kontrola ujemna: import pakietu z devDependencies jest wykrywany', () => {
    const fake: Manifest = { dependencies: { react: '^19' }, devDependencies: { '@react-email/render': '^1' } };
    expect(devOnlyImports("import { render } from '@react-email/render';", fake)).toEqual(['@react-email/render']);
    expect(devOnlyImports("import React from 'react'; import x from '@/lib/x'; import fs from 'node:fs';", fake)).toEqual([]);
    expect(devOnlyImports("import { render } from '@react-email/render';", { ...fake, dependencies: { '@react-email/render': '^1' } })).toEqual([]);
  });

  it('package-lock.json nie oznacza jako dev pakietów osiągalnych z dependencies', () => {
    const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8')) as {
      packages: Record<string, LockPackage & { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }>;
    };
    const root = lock.packages['']!;
    expect(Object.keys(root.dependencies ?? {}).sort()).toEqual(Object.keys(manifest.dependencies ?? {}).sort());
    expect(Object.keys(root.devDependencies ?? {}).sort()).toEqual(Object.keys(manifest.devDependencies ?? {}).sort());
    const { '': _root, ...rest } = lock.packages;
    void _root;
    expect(devFlaggedButProductionReachable(rest as Record<string, LockPackage>, Object.keys(manifest.dependencies ?? {}))).toEqual([]);
  });

  it('kontrola ujemna: pakiet dev osiągalny z dependencies jest wykrywany', () => {
    const packages: Record<string, LockPackage> = {
      'node_modules/a': { dependencies: { b: '1' } },
      'node_modules/b': { dev: true },
      'node_modules/c': { dev: true },
    };
    expect(devFlaggedButProductionReachable(packages, ['a'])).toEqual(['node_modules/b']);
    expect(devFlaggedButProductionReachable({ ...packages, 'node_modules/b': {} }, ['a'])).toEqual([]);
  });
});

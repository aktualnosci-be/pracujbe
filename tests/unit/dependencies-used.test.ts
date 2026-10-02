// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * #1121 (CFG29-05) — każdy wpis `dependencies`/`devDependencies` w `package.json` ma realne
 * użycie: import w kodzie, testach, skryptach albo plikach konfiguracyjnych z korzenia, albo
 * jawnie opisane użycie bez importu (`NON_IMPORT_USES`) — sprawdzane w pliku, który go
 * używa, więc nieaktualny wyjątek też jest czerwony. Martwe pakiety (dawniej `stripe`,
 * `prettier-plugin-tailwindcss`, `@radix-ui/react-slot`) nie wrócą niezauważone.
 */

const ROOT = process.cwd();
const SOURCE_DIRS = ['src', 'tests', 'scripts', 'infra'];
const SOURCE_EXT = /\.(?:[cm]?[jt]sx?)$/;
const IMPORT_RE = /(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)['"]([^'"]+)['"]/g;

/** Nazwa pakietu z określnika modułu (`@scope/pkg/sub` → `@scope/pkg`); null dla ścieżek i wbudowanych. */
function packageNameOf(specifier: string): string | null {
  if (/^(?:\.|\/|@\/|node:)/.test(specifier) || !/^[@a-z0-9]/i.test(specifier)) return null;
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
}

type Manifest = {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

/**
 * Pakiety używane bez instrukcji importu: plik + fragment, który musi w nim wystąpić.
 * Pakiety `@types/<pkg>` są używane, gdy używany jest `<pkg>` (sprawdzane osobno).
 */
const NON_IMPORT_USES: Record<string, { file: string; needle: string; why: string }> = {
  eslint: { file: 'package.json', needle: '"lint": "eslint', why: 'CLI lint' },
  'eslint-config-next': { file: '.eslintrc.json', needle: '"next/core-web-vitals"', why: 'extends ESLint' },
  autoprefixer: { file: 'postcss.config.mjs', needle: 'autoprefixer:', why: 'plugin PostCSS' },
  jsdom: { file: 'vitest.config.ts', needle: "environment: 'jsdom'", why: 'środowisko Vitest' },
  postcss: { file: 'postcss.config.mjs', needle: 'postcss-load-config', why: 'procesor CSS buildu' },
};

function walk(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SOURCE_EXT.test(entry)) out.push(full);
  }
}

function sourceFiles(): string[] {
  const files: string[] = [];
  for (const dir of SOURCE_DIRS) walk(join(ROOT, dir), files);
  for (const entry of readdirSync(ROOT)) {
    if (SOURCE_EXT.test(entry) && statSync(join(ROOT, entry)).isFile()) files.push(join(ROOT, entry));
  }
  return files;
}

/** Nazwy pakietów importowanych w podanych źródłach. */
export function importedPackages(sources: string[]): Set<string> {
  const found = new Set<string>();
  for (const source of sources) {
    for (const match of source.matchAll(IMPORT_RE)) {
      const name = packageNameOf(match[1]!);
      if (name) found.add(name);
    }
  }
  return found;
}

/** Zadeklarowane pakiety bez żadnego użycia (posortowane). */
export function unusedDependencies(
  manifest: Manifest,
  imported: Set<string>,
  hasNonImportUse: (name: string) => boolean,
): string[] {
  const declared = [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ];
  const used = (name: string): boolean => imported.has(name) || hasNonImportUse(name);
  return declared
    .filter((name) => {
      if (name.startsWith('@types/')) {
        const target = name.slice('@types/'.length);
        const pkg = target.includes('__') ? `@${target.replace('__', '/')}` : target;
        // @types/node: typy wbudowanych modułów Node (`node:*`), zawsze potrzebne.
        return pkg !== 'node' && !used(pkg);
      }
      return !used(name);
    })
    .sort();
}

function readRoot(file: string): string {
  return readFileSync(join(ROOT, file), 'utf8');
}

function nonImportUse(name: string): boolean {
  const use = NON_IMPORT_USES[name];
  return use ? readRoot(use.file).includes(use.needle) : false;
}

const manifest = JSON.parse(readRoot('package.json')) as Manifest;
const imported = importedPackages(sourceFiles().map((file) => readFileSync(file, 'utf8')));

describe('zależności package.json są używane (#1121)', () => {
  it('każdy pakiet ma import albo opisane użycie w konfiguracji', () => {
    expect(unusedDependencies(manifest, imported, nonImportUse)).toEqual([]);
  });

  it('wyjątki NON_IMPORT_USES dotyczą zadeklarowanych pakietów i są aktualne', () => {
    const declared = { ...manifest.dependencies, ...manifest.devDependencies };
    for (const [name, use] of Object.entries(NON_IMPORT_USES)) {
      expect(name in declared, `${name} nie jest w package.json — usuń wyjątek`).toBe(true);
      expect(imported.has(name), `${name} jest importowany — wyjątek zbędny`).toBe(false);
      expect(readRoot(use.file).includes(use.needle), `${name}: brak „${use.needle}” w ${use.file}`).toBe(
        true,
      );
    }
  });

  it('kontrola ujemna: pakiet bez importu i bez wyjątku jest wykrywany', () => {
    const withDead: Manifest = {
      ...manifest,
      devDependencies: { ...manifest.devDependencies, 'prettier-plugin-tailwindcss': '^0.6.9' },
    };
    expect(unusedDependencies(withDead, imported, nonImportUse)).toEqual(['prettier-plugin-tailwindcss']);
  });

  it('kontrola ujemna: @types bez pakietu i wyjątek bez fragmentu w pliku są wykrywane', () => {
    const withTypes: Manifest = { devDependencies: { '@types/left-pad': '^1.0.0', pg: '^8.0.0' } };
    expect(unusedDependencies(withTypes, new Set(['pg']), () => false)).toEqual(['@types/left-pad']);
    expect(unusedDependencies({ devDependencies: { autoprefixer: '^10' } }, new Set(), () => false)).toEqual([
      'autoprefixer',
    ]);
  });
});

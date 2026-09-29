// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { appendNodeOptions, quoteNodeOptionValue, requireNodeOption } from '../../scripts/lib/node-options.mjs';

/**
 * #915 — `scripts/test-e2e-real.mjs` przekazywał preload jako niecytowane `--require=<ścieżka>`
 * w `NODE_OPTIONS`; przy spacji w ścieżce repozytorium Node ładował tylko pierwszy fragment
 * (`Cannot find module`). Testy uruchamiają prawdziwy podproces z preloadem w katalogu ZE SPACJĄ.
 */

let dir: string | undefined;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

function spacedPreload(): string {
  dir = mkdtempSync(join(tmpdir(), 'pracuj be-'));
  const nested = join(dir, 'tests', 'e2e real');
  mkdirSync(nested, { recursive: true });
  const file = join(nested, 'hook.cjs');
  writeFileSync(file, "process.env.PRELOAD_HOOK_RAN = '1';\n");
  return file;
}

function runWith(nodeOptions: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, ['-e', "process.stdout.write(process.env.PRELOAD_HOOK_RAN ?? 'no')"], {
    env: { ...process.env, NODE_OPTIONS: nodeOptions },
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('NODE_OPTIONS ze ścieżką ze spacją (#915)', () => {
  it('preload w katalogu ze spacją ładuje się jako jedna ścieżka', () => {
    const file = spacedPreload();
    const result = runWith(requireNodeOption(file));
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('1');
  });

  it('kontrola ujemna: niecytowany zapis (stary kod) kończy się błędem modułu', () => {
    const file = spacedPreload();
    const result = runWith(`--require=${file}`);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/Cannot find module/);
  });

  it('prawdziwy plik hooka z repozytorium ładuje się przez helper', () => {
    const hook = resolve(process.cwd(), 'tests/e2e-real/support/server-only-hook.cjs');
    const result = runWith(requireNodeOption(hook));
    expect(result.status).toBe(0);
  });

  it('cytuje spację, backslash i cudzysłów; zwykła ścieżka zostaje bez zmian', () => {
    expect(quoteNodeOptionValue('/a/b/c.cjs')).toBe('/a/b/c.cjs');
    expect(quoteNodeOptionValue('/a b/c.cjs')).toBe('"/a b/c.cjs"');
    expect(quoteNodeOptionValue('C:\\Users\\Jan Kowalski\\hook.cjs')).toBe('"C:\\\\Users\\\\Jan Kowalski\\\\hook.cjs"');
    expect(quoteNodeOptionValue('/a "b"/c')).toBe('"/a \\"b\\"/c"');
  });

  it('dopisuje do istniejącego NODE_OPTIONS i pomija puste', () => {
    expect(appendNodeOptions(undefined, '--x')).toBe('--x');
    expect(appendNodeOptions('', '--x')).toBe('--x');
    expect(appendNodeOptions('--max-old-space-size=512', '--x')).toBe('--max-old-space-size=512 --x');
  });

  it('preload ze spacją współpracuje z istniejącym NODE_OPTIONS', () => {
    const file = spacedPreload();
    const result = runWith(appendNodeOptions('--no-warnings', requireNodeOption(file)));
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('1');
  });

  it('skrypt real-flow używa helpera, nie surowego --require', () => {
    const source = readFileSync(resolve(process.cwd(), 'scripts/test-e2e-real.mjs'), 'utf8');
    expect(source).toContain('requireNodeOption(serverOnlyHook)');
    expect(source).not.toMatch(/`--require=\$\{serverOnlyHook\}`/);
  });
});

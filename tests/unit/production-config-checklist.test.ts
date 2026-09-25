// @vitest-environment node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * #14: lista kontrolna konfiguracji produkcji (`docs/railway/KONFIGURACJA_PRODUKCJI.md`) nie może
 * rozjechać się z kodem. Każda zmienna czytana przez aplikację (`process.env.X` w src/,
 * next.config.mjs, skrypcie crona) jest na liście albo wśród zmiennych platformy/testów; każda
 * zmienna z listy jest w `.env.example`; rdzeń gotowości z listy = zmienne sprawdzane przez
 * `isAppReady()`.
 */

const ROOT = resolve(__dirname, '../..');
const doc = readFileSync(join(ROOT, 'docs/railway/KONFIGURACJA_PRODUKCJI.md'), 'utf8');
const envExample = readFileSync(join(ROOT, '.env.example'), 'utf8');

/** Zmienne platformy, frameworka i testów — nie konfiguruje ich operator usługi. */
const NOT_OPERATOR = new Set([
  'NODE_ENV', 'NEXT_RUNTIME', 'NEXT_PHASE', 'PORT', 'RAILWAY_GIT_COMMIT_SHA', 'GITHUB_SHA',
  'NEXT_PUBLIC_APP_VERSION', 'NEXT_PUBLIC_BUILD_TIME', 'PLAYWRIGHT_APPLICATIONS_FIXTURE',
  // Nazwa środowiska ustawiana przez Railway (etykieta w wiadomości webhooka błędów, #571).
  'RAILWAY_ENVIRONMENT_NAME',
]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx|mjs)$/.test(name) ? [path] : [];
  });
}

function envReads(): Set<string> {
  const sources = [...files(join(ROOT, 'src')), join(ROOT, 'next.config.mjs'), join(ROOT, 'scripts/railway-cron-call.mjs')];
  const names = new Set<string>();
  for (const file of sources) {
    for (const match of readFileSync(file, 'utf8').matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) names.add(match[1]!);
  }
  return names;
}

/** Nazwy w backtickach w tabelach/listach dokumentu. */
const documented = new Set([...doc.matchAll(/`([A-Z][A-Z0-9_]{2,})`/g)].map((m) => m[1]!));

function section(title: string): Set<string> {
  const start = doc.indexOf(title);
  const end = doc.indexOf('\n### ', start + title.length);
  const body = doc.slice(start, end === -1 ? undefined : end);
  const names = new Set<string>();
  for (const row of body.split('\n').filter((line) => line.startsWith('| `'))) {
    const firstCell = row.slice(1, row.indexOf(' |', 2));
    for (const m of firstCell.matchAll(/`([A-Z][A-Z0-9_]+)`/g)) names.add(m[1]!);
  }
  return names;
}

describe('lista kontrolna konfiguracji produkcji (#14)', () => {
  it('każda zmienna czytana przez aplikację jest na liście', () => {
    const missing = [...envReads()].filter((name) => !NOT_OPERATOR.has(name) && !documented.has(name));
    expect(missing).toEqual([]);
  });

  it('każda zmienna operatora z listy jest w .env.example (bez wartości sekretów)', () => {
    // Także wiersze zakomentowane (`# NAZWA=`) — opcjonalne zmienne opisane w pliku.
    const exampleNames = new Set([...envExample.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]!));
    // 2D = zmienne do usunięcia z usługi (np. Supabase po #27) — nie muszą już istnieć w przykładzie.
    const doNotSet = section('### 2D.');
    const operator = [...documented].filter((name) => !NOT_OPERATOR.has(name) && !doNotSet.has(name));
    expect(operator.filter((name) => !exampleNames.has(name))).toEqual([]);
  });

  it('rdzeń gotowości (2A) = zmienne sprawdzane przez isAppReady()', () => {
    const core = section('### 2A.');
    const env = readFileSync(join(ROOT, 'src/lib/env.ts'), 'utf8');
    for (const name of core) {
      if (name === 'APP_MODE' || name === 'NEXT_PUBLIC_SITE_URL') continue;
      expect(env, name).toContain(name);
    }
    expect([...core].sort()).toEqual([
      'APP_MODE', 'BETTER_AUTH_SECRET', 'BETTER_AUTH_URL', 'DATABASE_APP_URL', 'DATABASE_AUTH_URL',
      'DATABASE_RATE_LIMIT_URL', 'DATABASE_SERVICE_URL', 'NEXT_PUBLIC_SITE_URL', 'RATE_LIMIT_KEY_SECRET',
    ]);
  });

  it('Supabase i płatności są wyłącznie w wykazie „nie ustawiać”', () => {
    const forbidden = section('### 2D.');
    for (const name of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'BILLING_ENABLED', 'STRIPE_SECRET_KEY']) {
      expect(forbidden.has(name), name).toBe(true);
      for (const other of ['### 2A.', '### 2B.', '### 2C.']) expect(section(other).has(name), `${name} w ${other}`).toBe(false);
    }
  });

  it('dokument nie zawiera wartości sekretów (tylko nazwy)', () => {
    expect(doc).not.toMatch(/postgres(ql)?:\/\/[^<\s`]*:[^@\s`]+@/);
    expect(doc).not.toMatch(/\b(re|sk|whsec)_[A-Za-z0-9]{8,}/);
  });
});

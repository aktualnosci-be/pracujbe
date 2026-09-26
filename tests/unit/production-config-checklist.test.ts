// @vitest-environment node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * #14 + strażnik `.env.example`: lista kontrolna konfiguracji produkcji
 * (`docs/railway/KONFIGURACJA_PRODUKCJI.md`) i `.env.example` nie mogą rozjechać się z kodem.
 *
 * Zbieramy KAŻDĄ zmienną środowiska czytaną w `src/`, `scripts/` (`.ts/.tsx/.mts/.mjs/.cjs/.js/.py`)
 * i `next.config.mjs`: `process.env.X`, `process.env['X']`, `env.X`/`source.X` (parametr
 * z `process.env`, np. w `src/lib/env*` i skryptach), destrukturyzację `{ X } = process.env`,
 * wywołania `helper(env, 'X')`, `os.environ.get('X')` oraz — w plikach z dynamicznym odczytem
 * `env[name]` — literały z nazwami zmiennych. Każda (poza jawną allow-listą niżej) musi mieć:
 * - wpis w `.env.example` (także zakomentowany `# X=`) z komentarzem (w linii albo w bloku nad nią),
 * - wpis w dokumencie konfiguracji produkcji (nazwa w backtickach).
 * Skrypty powłoki (`*.sh`) nie są skanowane — ich zmienne dopisuj ręcznie.
 */

const ROOT = resolve(__dirname, '../..');
const DOC_PATH = 'docs/railway/KONFIGURACJA_PRODUKCJI.md';
const doc = readFileSync(join(ROOT, DOC_PATH), 'utf8');
const envExample = readFileSync(join(ROOT, '.env.example'), 'utf8');

/**
 * Zmienne platformy, frameworka, testów i CI — nie konfiguruje ich operator usługi, więc nie
 * wymagamy wpisu w `.env.example` ani w dokumencie. Każda pozycja MUSI mieć uzasadnienie.
 */
const NOT_OPERATOR: Readonly<Record<string, string>> = {
  // --- Platforma / Node / Next.js ---
  NODE_ENV: 'ustawia Next.js/Node (development/production/test)',
  NODE_OPTIONS: 'opcje Node przekazywane procesom potomnym w test-e2e-real',
  NEXT_RUNTIME: 'ustawia Next.js (nodejs/edge)',
  NEXT_PHASE: 'ustawia Next.js (faza builda/serwera)',
  PORT: 'ustawia Railway',
  RAILWAY_GIT_COMMIT_SHA: 'ustawia Railway (SHA wdrożenia)',
  RAILWAY_ENVIRONMENT_NAME: 'ustawia Railway (etykieta środowiska w webhooku błędów, #571)',
  NEXT_PUBLIC_APP_VERSION: 'wylicza next.config.mjs w czasie builda (build-version)',
  NEXT_PUBLIC_BUILD_TIME: 'wylicza next.config.mjs w czasie builda',
  // --- GitHub Actions ---
  GITHUB_SHA: 'ustawia GitHub Actions (wersja builda w CI)',
  GITHUB_STEP_SUMMARY: 'ustawia GitHub Actions (podsumowanie kroku budżetu wydajności)',
  PERF_LAB_DEBUG: 'diagnostyka kroku lab CWV w CI (skrypt perf-lab)',
  // --- Testy (Playwright, E2E na PostgreSQL, testy skryptów bazy) ---
  PLAYWRIGHT_APPLICATIONS_FIXTURE: 'serwer fixture E2E (Playwright)',
  PLAYWRIGHT_BROWSERS_PATH: 'lokalizacja przeglądarek Playwright (testy/eksport grafik poza CI)',
  PLAYWRIGHT_CHROMIUM_PATH: 'lokalny Chromium do eksportu grafik i testów (#378), nie usługa',
  E2E_PGHOST: 'npm run test:e2e:real — izolowana baza testowa',
  E2E_PGPORT: 'npm run test:e2e:real — izolowana baza testowa',
  E2E_PGUSER: 'npm run test:e2e:real — izolowana baza testowa',
  E2E_PGPASSWORD: 'npm run test:e2e:real — izolowana baza testowa',
  E2E_PGDATABASE: 'npm run test:e2e:real — izolowana baza testowa (nazwa musi zawierać „e2e”)',
  E2E_REAL_KEEP: 'npm run test:e2e:real — zostawia bazę po teście (diagnostyka)',
  E2E_REAL_MUTATION: 'npm run test:e2e:real — kontrole ujemne (mutacje)',
  AUTH_SCHEMA_TEST_DATABASE_URL: 'test schematu Better Auth na jednorazowej bazie',
  AUTH_SCHEMA_TEST_ISOLATED_CLUSTER: 'test schematu Better Auth — potwierdzenie izolowanego klastra',
  BOOTSTRAP_TEST_DATABASE_URL: 'test bootstrapu ról na jednorazowej bazie',
  BOOTSTRAP_TEST_ISOLATED_CLUSTER: 'test bootstrapu ról — potwierdzenie izolowanego klastra',
  MIGRATION_TEST_DATABASE_URL: 'test migracji na jednorazowej bazie',
  ESCO_TEST_DATABASE_URL: 'npm run test:esco na jednorazowej bazie',
  BACKUP_S3_ALLOW_INSECURE_LOCAL: 'tylko atrapa S3 w testach (http na localhost), nigdy produkcja',
  VIES_LIVE_SMOKE: 'opt-in smoke VIES na żywym API (test ręczny)',
  TEST_NETWORK_ALLOW: 'testy — zezwolenie na sieć w teście',
  // --- Deterministyczny build fontu (scripts/subset-font.py) ---
  PYTHONHASHSEED: 'powtarzalny podzbiór fontu (subset-font.py)',
  SOURCE_DATE_EPOCH: 'powtarzalny podzbiór fontu (subset-font.py)',
};

const NAME = '[A-Z][A-Z0-9_]*[A-Z0-9]';
const RECEIVER = '(?:process\\.env|env|source)';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx|mts|mjs|cjs|js|py)$/.test(name) ? [path] : [];
  });
}

/** Nazwy zmiennych środowiska czytanych w jednym pliku źródłowym. */
function envReadsInSource(text: string): Set<string> {
  const names = new Set<string>();
  const add = (n: string | undefined) => n && names.add(n);
  for (const m of text.matchAll(new RegExp(`\\b${RECEIVER}\\??\\.(${NAME})\\b`, 'g'))) add(m[1]);
  for (const m of text.matchAll(new RegExp(`\\b${RECEIVER}\\??\\.?\\[\\s*['"\`](${NAME})['"\`]\\s*\\]`, 'g'))) add(m[1]);
  for (const m of text.matchAll(/\{([^{}]*)\}\s*=\s*(?:process\.env|env)\b/g)) {
    for (const k of m[1]!.matchAll(new RegExp(`(?:^|[,\\s])(${NAME})\\b`, 'g'))) add(k[1]);
  }
  for (const m of text.matchAll(new RegExp(`\\(\\s*(?:process\\.env|env)\\s*,\\s*['"](${NAME})['"]`, 'g'))) add(m[1]);
  for (const m of text.matchAll(new RegExp(`os\\.environ(?:\\.get\\(|\\[)\\s*['"](${NAME})['"]`, 'g'))) add(m[1]);
  // Dynamiczny odczyt `env[name]`: nazwy stoją jako literały w tym samym pliku.
  if (/\b(?:process\.env|env)\[\s*[a-z]/.test(text)) {
    for (const m of text.matchAll(new RegExp(`['"](${NAME})['"]`, 'g'))) if (m[1]!.includes('_')) add(m[1]);
  }
  return names;
}

function envReads(): Map<string, string> {
  const sources = [...files(join(ROOT, 'src')), ...files(join(ROOT, 'scripts')), join(ROOT, 'next.config.mjs')];
  const found = new Map<string, string>();
  for (const file of sources) {
    for (const name of envReadsInSource(readFileSync(file, 'utf8'))) {
      if (!found.has(name)) found.set(name, relative(ROOT, file));
    }
  }
  return found;
}

/** Nazwy w backtickach w dokumencie. */
function documentedIn(text: string): Set<string> {
  return new Set([...text.matchAll(/`([A-Z][A-Z0-9_]{2,})`/g)].map((m) => m[1]!));
}

/** Nazwy zmiennych w `.env.example` (także zakomentowane `# X=`), z informacją o komentarzu. */
function exampleEntries(text: string): Map<string, { commented: boolean }> {
  const lines = text.split('\n');
  const varLine = /^#?\s*([A-Z][A-Z0-9_]+)=/;
  const entries = new Map<string, { commented: boolean }>();
  lines.forEach((line, index) => {
    const match = varLine.exec(line);
    if (!match) return;
    // Komentarz w linii (po wartości) albo linia komentarza w bloku bezpośrednio nad nią.
    let commented = /=\s*("[^"]*"|'[^']*'|[^\s#]*)\s+#\s*\S/.test(line);
    for (let i = index - 1; !commented && i >= 0; i--) {
      const above = lines[i]!.trim();
      if (above === '') break;
      if (above.startsWith('#') && !varLine.test(above)) commented = true;
    }
    const prev = entries.get(match[1]!);
    entries.set(match[1]!, { commented: commented || Boolean(prev?.commented) });
  });
  return entries;
}

/** Zmienne czytane w kodzie bez wpisu w przykładzie/dokumencie (poza allow-listą). */
function missingEnvEntries(
  reads: Iterable<string>,
  exampleText: string,
  docText: string,
): { notInExample: string[]; withoutComment: string[]; notInDoc: string[] } {
  const example = exampleEntries(exampleText);
  const documented = documentedIn(docText);
  const operator = [...reads].filter((name) => !(name in NOT_OPERATOR)).sort();
  return {
    notInExample: operator.filter((name) => !example.has(name)),
    withoutComment: operator.filter((name) => example.has(name) && !example.get(name)!.commented),
    notInDoc: operator.filter((name) => !documented.has(name)),
  };
}

const documented = documentedIn(doc);

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

describe('zmienne środowiska: kod ↔ .env.example ↔ konfiguracja produkcji', () => {
  const reads = envReads();

  it('kolektor widzi zmienne z src/, scripts/ i next.config.mjs (sanity)', () => {
    for (const name of ['APP_MODE', 'DATABASE_APP_URL', 'CRON_TARGET_URL', 'MIGRATION_MODE', 'BACKUP_S3_READ_ACCESS_KEY_ID', 'RAILWAY_GIT_COMMIT_SHA']) {
      expect(reads.has(name), name).toBe(true);
    }
  });

  it('każda zmienna czytana w kodzie ma wpis z komentarzem w .env.example i w dokumencie', () => {
    const { notInExample, withoutComment, notInDoc } = missingEnvEntries(reads.keys(), envExample, doc);
    const where = (names: string[]) => names.map((name) => `${name} (${reads.get(name)})`);
    expect(where(notInExample), '.env.example').toEqual([]);
    expect(where(withoutComment), '.env.example bez komentarza').toEqual([]);
    expect(where(notInDoc), DOC_PATH).toEqual([]);
  });

  it('allow-lista jest ścisła: każda pozycja ma uzasadnienie i nie jest opisana jako konfiguracja operatora', () => {
    for (const [name, reason] of Object.entries(NOT_OPERATOR)) {
      expect(reason.trim().length, name).toBeGreaterThan(10);
      // Zmienna z allow-listy nie może jednocześnie udawać konfiguracji usługi (sekcje 2A–2C).
      for (const title of ['### 2A.', '### 2B.', '### 2C.']) expect(section(title).has(name), `${name} w ${title}`).toBe(false);
    }
  });

  it('kontrola ujemna: zmienna tylko w kodzie (bez wpisu) jest wykrywana', () => {
    const source = [
      "const a = process.env.ONLY_IN_CODE_A;",
      "const { ONLY_IN_CODE_B, APP_MODE } = process.env;",
      "export function f(env) { return env.ONLY_IN_CODE_C ?? required(env, 'ONLY_IN_CODE_D'); }",
      "const e = process.env['ONLY_IN_CODE_E'];",
    ].join('\n');
    const found = envReadsInSource(source);
    expect([...found].sort()).toEqual(['APP_MODE', 'ONLY_IN_CODE_A', 'ONLY_IN_CODE_B', 'ONLY_IN_CODE_C', 'ONLY_IN_CODE_D', 'ONLY_IN_CODE_E']);
    const result = missingEnvEntries(found, envExample, doc);
    expect(result.notInExample).toEqual(['ONLY_IN_CODE_A', 'ONLY_IN_CODE_B', 'ONLY_IN_CODE_C', 'ONLY_IN_CODE_D', 'ONLY_IN_CODE_E']);
    expect(result.notInDoc).toEqual(['ONLY_IN_CODE_A', 'ONLY_IN_CODE_B', 'ONLY_IN_CODE_C', 'ONLY_IN_CODE_D', 'ONLY_IN_CODE_E']);
    // Wpis bez komentarza też jest błędem.
    const bare = missingEnvEntries(['ONLY_IN_CODE_A'], 'X="1"\n\nONLY_IN_CODE_A=""\n', '`ONLY_IN_CODE_A`');
    expect(bare).toEqual({ notInExample: [], withoutComment: ['ONLY_IN_CODE_A'], notInDoc: [] });
    const ok = missingEnvEntries(['ONLY_IN_CODE_A'], '# opis\nONLY_IN_CODE_A=""\n', '`ONLY_IN_CODE_A`');
    expect(ok).toEqual({ notInExample: [], withoutComment: [], notInDoc: [] });
  });

  it('każda zmienna operatora z listy jest w .env.example (bez wartości sekretów)', () => {
    const exampleNames = new Set(exampleEntries(envExample).keys());
    // 2D = zmienne do usunięcia z usługi (np. Supabase po #27) — nie muszą już istnieć w przykładzie.
    const doNotSet = section('### 2D.');
    const operator = [...documented].filter((name) => !(name in NOT_OPERATOR) && !doNotSet.has(name));
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
      for (const other of ['### 2A.', '### 2B.', '### 2C.', '### 2E.']) expect(section(other).has(name), `${name} w ${other}`).toBe(false);
    }
  });

  it('dokument i .env.example nie zawierają wartości sekretów (tylko nazwy)', () => {
    for (const text of [doc, envExample]) {
      expect(text).not.toMatch(/postgres(ql)?:\/\/[^<\s`"]*:[^@\s`"]+@/);
      expect(text).not.toMatch(/\b(re|sk|whsec)_[A-Za-z0-9]{8,}/);
    }
  });
});

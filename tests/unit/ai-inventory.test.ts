import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  AI_FEATURE_IDS,
  AI_FEATURES,
  AI_SDK_PACKAGES,
  containsModelCall,
  NON_AI_CANDIDATE_FEATURES,
  undeclaredCallSites,
} from '@/lib/ai/inventory';

/**
 * #489 — każde wywołanie modelu w kodzie produkcyjnym (`src/`, `scripts/`) ma wpis
 * w inwentarzu `src/lib/ai/inventory.ts`. Testy (`tests/`) mockują SDK i nie są skanowane.
 */

const ROOT = join(__dirname, '..', '..');
const SCANNED = ['src', 'scripts'];
const EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXTENSIONS.test(name)) out.push(full);
  }
  return out;
}

function sourceFiles() {
  return SCANNED.flatMap((dir) => walk(join(ROOT, dir))).map((full) => ({
    path: relative(ROOT, full).split('\\').join('/'),
    source: readFileSync(full, 'utf8'),
  }));
}

describe('inwentarz AI (#489)', () => {
  it('każdy plik z wywołaniem modelu jest w inwentarzu', () => {
    expect(undeclaredCallSites(sourceFiles())).toEqual([]);
  });

  it('kontrola ujemna: nowe wywołanie modelu spoza inwentarza jest wykryte', () => {
    const files = [
      ...sourceFiles(),
      { path: 'src/lib/new-feature/rank.ts', source: "import Anthropic from '@anthropic-ai/sdk';\n" },
      { path: 'src/lib/new-feature/score.ts', source: "import OpenAI from 'openai';\n" },
      { path: 'scripts/raw-call.mjs', source: "await fetch('https://api.anthropic.com/v1/messages');\n" },
      { path: 'src/lib/new-feature/lazy.ts', source: "const sdk = await import('@anthropic-ai/sdk');\n" },
      // OpenAI: podścieżka SDK, require, import dynamiczny, surowe HTTP i wspólny klient.
      { path: 'src/lib/new-feature/types.ts', source: "import type { Response } from 'openai/resources/responses/responses';\n" },
      { path: 'scripts/cjs.cjs', source: "const OpenAI = require('openai');\n" },
      { path: 'src/lib/new-feature/lazy-openai.ts', source: "const { default: OpenAI } = await import('openai');\n" },
      { path: 'scripts/raw-openai.mjs', source: "await fetch('https://api.openai.com/v1/responses', { method: 'POST' });\n" },
      { path: 'src/lib/new-feature/shared.ts', source: "import { createStructuredResponse } from '@/lib/ai/openai';\n" },
      { path: 'src/lib/ai/relative.ts', source: "import { createStructuredResponse } from './openai';\n" },
    ];
    expect(undeclaredCallSites(files)).toEqual([
      'scripts/cjs.cjs',
      'scripts/raw-call.mjs',
      'scripts/raw-openai.mjs',
      'src/lib/ai/relative.ts',
      'src/lib/new-feature/lazy-openai.ts',
      'src/lib/new-feature/lazy.ts',
      'src/lib/new-feature/rank.ts',
      'src/lib/new-feature/score.ts',
      'src/lib/new-feature/shared.ts',
      'src/lib/new-feature/types.ts',
    ]);
    // Konfiguracja modelu (bez SDK) nie jest wywołaniem modelu.
    expect(containsModelCall("import { resolveAiModel } from '@/lib/ai/model-config';\n")).toBe(false);
  });

  it('wpisy „behind_flag” wskazują istniejące pliki, które faktycznie wołają model', () => {
    for (const feature of AI_FEATURES.filter((f) => f.status === 'behind_flag')) {
      for (const path of feature.callSites) {
        expect(existsSync(join(ROOT, path)), path).toBe(true);
        expect(containsModelCall(readFileSync(join(ROOT, path), 'utf8')), path).toBe(true);
      }
    }
  });

  it('identyfikatory są unikalne i zgodne z listą AI_FEATURE_IDS', () => {
    expect(AI_FEATURES.map((f) => f.id).sort()).toEqual([...AI_FEATURE_IDS].sort());
  });

  it('funkcja bez człowieka w pętli ma opisany krok i żadna nie decyduje o osobie', () => {
    for (const feature of AI_FEATURES) {
      expect(feature.decidesAboutPerson).toBe(false);
      expect(feature.humanStep.length).toBeGreaterThan(20);
    }
  });

  it('każdy pakiet SDK modelu w package.json ma funkcję w inwentarzu', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const aiPackages = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((name) =>
      AI_SDK_PACKAGES.some((p) => p.test(name)),
    );
    // Decyzja właściciela 2026-09-26: jedyny dostawca to OpenAI (SDK `openai`).
    expect(aiPackages).toEqual(['openai']);
    expect(AI_FEATURES.some((f) => f.provider === 'openai')).toBe(true);
  });

  it('funkcje „behind_flag” używają wyłącznie OpenAI przez wspólnego klienta (decyzja 2026-09-26)', () => {
    for (const feature of AI_FEATURES.filter((f) => f.status === 'behind_flag')) {
      expect(feature.provider, feature.id).toBe('openai');
      expect(feature.callSites, feature.id).toContain('src/lib/ai/openai.ts');
    }
  });

  it('SDK Anthropic nie jest używane w kodzie produkcyjnym (kontrola ujemna)', () => {
    const ANTHROPIC = /['"]@anthropic-ai\/[^'"]+['"]|api\.anthropic\.com/;
    const offenders = sourceFiles()
      .filter((f) => !f.path.startsWith('src/lib/ai/inventory.ts') && ANTHROPIC.test(f.source))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
    expect("import Anthropic from '@anthropic-ai/sdk';").toMatch(ANTHROPIC);
  });

  it('SDK OpenAI importuje wyłącznie wspólny klient src/lib/ai/openai.ts', () => {
    const SDK = /(?:from|require\(|import\()\s*['"]openai(?:\/[^'"]*)?['"]/;
    const importers = sourceFiles().filter((f) => SDK.test(f.source)).map((f) => f.path);
    expect(importers).toEqual(['src/lib/ai/openai.ts']);
    expect("import OpenAI from 'openai';").toMatch(SDK);
  });

  it('funkcje dotyczące kandydatów spoza inwentarza nie wołają modelu (art. 22 — brak AI)', () => {
    for (const feature of NON_AI_CANDIDATE_FEATURES) {
      for (const path of feature.files) {
        expect(existsSync(join(ROOT, path)), path).toBe(true);
        expect(containsModelCall(readFileSync(join(ROOT, path), 'utf8')), path).toBe(false);
      }
    }
  });

  it('import ogłoszenia zapisuje tylko szkic — akcja nie woła publikacji', () => {
    const action = readFileSync(join(ROOT, 'src/lib/actions/job-import.ts'), 'utf8');
    // #25: RPC przez helper `rpc(tx, 'nazwa', …)` z src/lib/db/sql.ts.
    const PUBLISH = /rpc(?:Rows)?\((?:\s*\w+\s*,)?\s*['"]publish_job|\bpublishJob\b/;
    expect(action).toMatch(/rpc\(\s*tx,\s*'save_job_draft'/);
    expect(action).not.toMatch(PUBLISH);
    // Kontrola ujemna reguły: wywołanie publikacji byłoby wykryte.
    expect("await rpc(tx, 'publish_job', { p_job_id: id })").toMatch(PUBLISH);
  });

  it('asystent redagowania (#37) niczego nie zapisuje — akcja nie woła bazy do zapisu ani publikacji', () => {
    const WRITE = /\brpc(?:Rows)?\(|\bsql\(|save_job_draft|publish_job|update_published_job|\bpublishJob\b|\bupdateJobDraft\b/;
    for (const path of ['src/lib/actions/job-assist.ts', 'src/lib/ai-assist/run-assist.ts', 'src/lib/ai-assist/assist.ts']) {
      expect(readFileSync(join(ROOT, path), 'utf8'), path).not.toMatch(WRITE);
    }
    // Kontrola ujemna reguły.
    expect("await rpc(tx, 'save_job_draft', { p_job_id: id })").toMatch(WRITE);
  });

  it('kod funkcji AI nie dotyka statusu, widoczności ani kolejności kandydatów', () => {
    const files = [
      ...AI_FEATURES.flatMap((f) => f.callSites),
      'src/lib/actions/job-import.ts',
      'src/lib/ai-import/run-import.ts',
      'src/lib/actions/job-assist.ts',
      'src/lib/ai-assist/run-assist.ts',
    ];
    const forbidden = /transition_application|apply_to_job|withdraw_application|is_searchable|set_candidate_searchable|public\.matches|from\(['"]matches['"]\)|from\(['"]applications['"]\)|\bpublic\.applications\b/;
    for (const path of files.filter((p) => existsSync(join(ROOT, p)))) {
      expect(readFileSync(join(ROOT, path), 'utf8'), path).not.toMatch(forbidden);
    }
    // Kontrola ujemna reguły.
    expect("await supabase.rpc('transition_application', { p_status: 'rejected' })").toMatch(forbidden);
  });

  it('funkcje „behind_flag” przechodzą przez globalny budżet kosztów (#36)', () => {
    const unbudgeted = AI_FEATURES.filter((f) => f.status === 'behind_flag' && !f.costBudgeted).map((f) => f.id);
    expect(unbudgeted).toEqual([]);
    // Kontrola ujemna reguły: wpis bez budżetu jest wykrywany.
    const bad = { ...AI_FEATURES[0]!, status: 'behind_flag' as const, costBudgeted: false };
    expect([bad].filter((f) => f.status === 'behind_flag' && !f.costBudgeted)).toHaveLength(1);
  });

  it('akcja importu owija ekstraktor budżetem przed wywołaniem modelu (#36)', () => {
    const action = readFileSync(join(ROOT, 'src/lib/actions/job-import.ts'), 'utf8');
    expect(action).toMatch(/withJobImportBudget\(logged, model\)/);
    // Płatny dostawca nie ma ścieżki z pominięciem budżetu: wyjątek tylko dla atrapy bez bazy.
    expect(action).toMatch(/provider === 'fixture' && !isServiceDatabaseConfigured\(\) \? logged : withJobImportBudget/);
  });
});

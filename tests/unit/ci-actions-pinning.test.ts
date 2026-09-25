import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * #73 — GitHub wymusza runtime Node 24 dla akcji `actions/*`; majory poniżej progu
 * emitują ostrzeżenie o przestarzałym runtime w każdym jobie. Test blokuje regres do
 * przestarzałego majora którejkolwiek objętej oficjalnej akcji.
 *
 * #601 — jedyny krok spoza `actions/*` (`Mattraks/delete-workflow-runs`, uprawnienie
 * `actions: write`) musi być przypięty do pełnego SHA, nie do ruchomego taga: zmiana
 * publikacji akcji albo przejęcie taga nie może po cichu podmienić wykonywanego kodu.
 */

const WORKFLOW_DIR = resolve(process.cwd(), '.github', 'workflows');

function workflowSources(): Map<string, string> {
  return new Map(
    readdirSync(WORKFLOW_DIR)
      .filter((file) => /\.ya?ml$/.test(file))
      .map((file) => [file, readFileSync(resolve(WORKFLOW_DIR, file), 'utf8')]),
  );
}

const MINIMUM_OFFICIAL_MAJORS: Record<string, number> = {
  'actions/checkout': 7,
  'actions/setup-node': 7,
  'actions/cache': 6,
  'actions/cache/restore': 6,
  'actions/cache/save': 6,
  'actions/upload-artifact': 7,
};

function obsoleteOfficialActions(source: string): string[] {
  const obsolete: string[] = [];
  for (const match of source.matchAll(/uses:\s*(actions\/[\w-]+(?:\/[\w-]+)?)@v(\d+)/g)) {
    const action = match[1] ?? '';
    const majorText = match[2] ?? '0';
    const minimum = MINIMUM_OFFICIAL_MAJORS[action];
    if (minimum !== undefined && Number(majorText) < minimum) obsolete.push(`${action}@v${majorText}`);
  }
  return obsolete;
}

/** `uses:` spoza `actions/*` — muszą wskazywać pełny 40-znakowy SHA, nie tag/branch/skrót. */
function unpinnedThirdPartyActions(source: string): string[] {
  const unpinned: string[] = [];
  for (const match of source.matchAll(/uses:\s*([\w.-]+\/[\w.-]+)@([^\s#]+)/g)) {
    const full = match[0];
    const action = match[1] ?? '';
    const ref = match[2] ?? '';
    if (action.startsWith('actions/')) continue;
    if (!/^[0-9a-f]{40}$/i.test(ref)) unpinned.push(full.trim());
  }
  return unpinned;
}

describe('oficjalne akcje GitHub na runtime Node 24 (#73)', () => {
  it('żaden workflow nie używa majora poniżej minimum', () => {
    const obsolete = [...workflowSources()].flatMap(([file, source]) =>
      obsoleteOfficialActions(source).map((ref) => `${file}: ${ref}`),
    );
    expect(obsolete).toEqual([]);
  });

  it('kontrola ujemna: wykrywa poprzednie akcje oparte na Node 20 (@v4)', () => {
    const previous = `
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - uses: actions/cache@v4
      - uses: actions/cache/restore@v4
      - uses: actions/cache/save@v4
      - uses: actions/upload-artifact@v4
    `;
    expect(obsoleteOfficialActions(previous)).toEqual([
      'actions/checkout@v4',
      'actions/setup-node@v4',
      'actions/cache@v4',
      'actions/cache/restore@v4',
      'actions/cache/save@v4',
      'actions/upload-artifact@v4',
    ]);
  });
});

describe('zewnętrzne akcje spoza actions/* przypięte do pełnego SHA (#601)', () => {
  it('każde uses: spoza actions/* wskazuje 40-znakowy SHA', () => {
    const unpinned = [...workflowSources()].flatMap(([file, source]) =>
      unpinnedThirdPartyActions(source).map((ref) => `${file}: ${ref}`),
    );
    expect(unpinned).toEqual([]);
  });

  it('kontrola ujemna: wykrywa ruchomy tag semver zamiast SHA', () => {
    expect(unpinnedThirdPartyActions('uses: Mattraks/delete-workflow-runs@v2.0.6')).toEqual([
      'uses: Mattraks/delete-workflow-runs@v2.0.6',
    ]);
  });

  it('kontrola ujemna: wykrywa skrócony SHA (za krótki, by być jednoznaczny)', () => {
    expect(unpinnedThirdPartyActions('uses: some/action@39f0bbe')).toEqual(['uses: some/action@39f0bbe']);
  });

  it('rozpoznaje pełny SHA jako przypięty, z komentarzem wersji albo bez', () => {
    expect(unpinnedThirdPartyActions('uses: some/action@39f0bbed25d76b34de5594dceab824811479e5de')).toEqual([]);
    expect(
      unpinnedThirdPartyActions('uses: some/action@39f0bbed25d76b34de5594dceab824811479e5de # v2.0.6'),
    ).toEqual([]);
  });
});

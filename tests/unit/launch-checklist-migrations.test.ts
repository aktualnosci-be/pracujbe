// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Stan migracji produkcji w dokumentach startowych.
 *
 * `docs/LAUNCH_CHECKLIST.md` (§0 wiersz „Baza”, §4 pierwszy punkt) i sekcja 0 `CLAUDE.md`
 * podają numer ostatniej migracji zastosowanej na produkcji. Numer wpisuje człowiek po
 * `apply`, więc strażnik nie wie, co jest na produkcji — pilnuje tylko spójności:
 *   1. trzy miejsca podają TEN SAM numer,
 *   2. numer istnieje jako plik migracji w repozytorium (nie numer tymczasowy),
 *   3. każda pozycja §4 „[ ]” z numerem migracji wskazuje migrację NOWSZĄ niż zastosowana
 *      i istniejącą w repo (koniec punktów „do zastosowania” dla migracji już zastosowanych),
 *   4. wiersz §0 z „`main` ma … `NNNN`” wskazuje migrację nowszą od zastosowanej.
 * Nowa migracja na `main` nie wymaga zmiany dokumentów (to byłby koszt dla każdej sesji).
 */

const MIGRATION_DIRS = ['supabase/migrations', 'database/bootstrap', 'database/auth'];

function repoMigrationNumbers(): Set<string> {
  const numbers = new Set<string>();
  for (const dir of MIGRATION_DIRS) {
    for (const file of readdirSync(dir)) {
      const match = /^(\d{4})_.+\.sql$/.exec(file);
      if (match?.[1]) numbers.add(match[1]);
    }
  }
  return numbers;
}

function section(markdown: string, heading: RegExp): string {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => heading.test(line));
  if (start < 0) return '';
  const end = lines.findIndex((line, index) => index > start && /^## /.test(line));
  return lines.slice(start, end < 0 ? undefined : end).join('\n');
}

type MigrationDocState = {
  checklistSection0: string | null;
  checklistSection4: string | null;
  claudeTldr: string | null;
  pendingInSection4: string[];
  mainHasInSection0: string[];
};

function readMigrationDocState(checklist: string, claude: string): MigrationDocState {
  const s0 = section(checklist, /^## 0\. /);
  const s4 = section(checklist, /^## 4\. /);
  const baseRow = s0.split('\n').find((line) => line.startsWith('| Baza |')) ?? '';
  const appliedS0 = /zastosowane do `(\d{4})`/.exec(baseRow)?.[1] ?? null;
  const appliedS4 = /- \[x\][^\n]*migracje do `(\d{4})`/.exec(s4)?.[1] ?? null;
  const tldr = section(claude, /^## 0\. /);
  const appliedClaude = /produkcja na migracji (\d{4})/.exec(tldr)?.[1] ?? null;
  const pending = s4
    .split('\n')
    .filter((line) => line.startsWith('- [ ]'))
    .flatMap((line) => [...line.matchAll(/`(\d{4})`/g)].flatMap((m) => (m[1] ? [m[1]] : [])));
  const mainHas = [...baseRow.matchAll(/`main` ma[^|]*?`(\d{4})`/g)].flatMap((m) => (m[1] ? [m[1]] : []));
  return {
    checklistSection0: appliedS0,
    checklistSection4: appliedS4,
    claudeTldr: appliedClaude,
    pendingInSection4: pending,
    mainHasInSection0: mainHas,
  };
}

function migrationDocProblems(state: MigrationDocState, repo: Set<string>): string[] {
  const problems: string[] = [];
  const { checklistSection0: s0, checklistSection4: s4, claudeTldr: tldr } = state;
  if (!s0) problems.push('LAUNCH_CHECKLIST §0: brak „zastosowane do `NNNN`” w wierszu Baza');
  if (!s4) problems.push('LAUNCH_CHECKLIST §4: brak „[x] … migracje do `NNNN`”');
  if (!tldr) problems.push('CLAUDE.md §0: brak „produkcja na migracji NNNN”');
  if (!s0 || !s4 || !tldr) return problems;
  if (new Set([s0, s4, tldr]).size !== 1) {
    problems.push(`numery niezgodne: §0=${s0}, §4=${s4}, CLAUDE.md=${tldr}`);
  }
  for (const [where, number] of [
    ['§0', s0],
    ['§4', s4],
    ['CLAUDE.md', tldr],
  ] as const) {
    if (!repo.has(number)) problems.push(`${where}: migracji ${number} nie ma w repozytorium`);
  }
  for (const number of state.pendingInSection4) {
    if (number <= s4) problems.push(`§4: pozycja „[ ]” wskazuje migrację ${number}, już zastosowaną (≤ ${s4})`);
    else if (!repo.has(number)) problems.push(`§4: pozycja „[ ]” wskazuje migrację ${number}, której nie ma w repo`);
  }
  for (const number of state.mainHasInSection0) {
    if (number <= s0) problems.push(`§0: „main ma” wskazuje migrację ${number}, już zastosowaną (≤ ${s0})`);
  }
  return problems;
}

const checklist = readFileSync(join('docs', 'LAUNCH_CHECKLIST.md'), 'utf8');
const claude = readFileSync('CLAUDE.md', 'utf8');
const repo = repoMigrationNumbers();

describe('stan migracji produkcji w dokumentach startowych', () => {
  it('LAUNCH_CHECKLIST §0/§4 i CLAUDE.md §0 są spójne z repozytorium', () => {
    expect(migrationDocProblems(readMigrationDocState(checklist, claude), repo)).toEqual([]);
  });

  it('numer zastosowanej migracji nie przekracza najnowszej w repo', () => {
    const latest = [...repo].sort().at(-1)!;
    const { checklistSection0 } = readMigrationDocState(checklist, claude);
    expect(checklistSection0! <= latest).toBe(true);
  });

  describe('kontrole ujemne', () => {
    const applied = readMigrationDocState(checklist, claude).checklistSection0!;
    const older = [...repo].filter((n) => n < applied).sort().at(-1)!;

    it('niezgodny numer w §4 = błąd', () => {
      const mutated = checklist.replace(/(- \[x\][^\n]*migracje do `)\d{4}`/, `$1${older}\``);
      expect(migrationDocProblems(readMigrationDocState(mutated, claude), repo)).toContainEqual(
        expect.stringContaining('numery niezgodne'),
      );
    });

    it('niezgodny numer w CLAUDE.md = błąd', () => {
      const mutated = claude.replace(/produkcja na migracji \d{4}/, `produkcja na migracji ${older}`);
      expect(migrationDocProblems(readMigrationDocState(checklist, mutated), repo)).toContainEqual(
        expect.stringContaining('numery niezgodne'),
      );
    });

    it('numer spoza repozytorium (tymczasowy) = błąd', () => {
      const mutated = checklist
        .replace(/zastosowane do `\d{4}`/, 'zastosowane do `9999`')
        .replace(/(- \[x\][^\n]*migracje do `)\d{4}`/, '$19999`');
      const mutatedClaude = claude.replace(/produkcja na migracji \d{4}/, 'produkcja na migracji 9999');
      const problems = migrationDocProblems(readMigrationDocState(mutated, mutatedClaude), repo);
      expect(problems).toContainEqual(expect.stringContaining('migracji 9999 nie ma w repozytorium'));
    });

    it('pozycja „do zastosowania” dla migracji już zastosowanej = błąd (stan sprzed 27.09)', () => {
      const mutated = checklist.replace(/(## 4\. [^\n]*\n\n)/, `$1- [ ] \`${older}\` zastosowana po wdrożeniu \`main\`.\n`);
      expect(migrationDocProblems(readMigrationDocState(mutated, claude), repo)).toContainEqual(
        expect.stringContaining(`wskazuje migrację ${older}, już zastosowaną`),
      );
    });

    it('„main ma” ze starszym numerem = błąd', () => {
      const mutated = checklist.replace(/(\| Baza \| [^\n]*?)\|\n/, `$1; \`main\` ma już \`${older}\` |\n`);
      expect(migrationDocProblems(readMigrationDocState(mutated, claude), repo)).toContainEqual(
        expect.stringContaining('„main ma”'),
      );
    });

    it('brak wiersza Baza = błąd', () => {
      const mutated = checklist.replace(/\| Baza \|/, '| Dane |');
      expect(migrationDocProblems(readMigrationDocState(mutated, claude), repo)).toContainEqual(
        expect.stringContaining('wiersz'),
      );
    });
  });
});

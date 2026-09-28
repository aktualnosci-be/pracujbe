// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Strażnik zapisu decyzji produktowej „portal ogłoszeniowy” (#1154, epik #1128) w dokumentach,
 * które czytają kolejne sesje i właściciel przed startem. Usunięcie znacznika albo odesłania
 * do sub-issue = czerwony test (kontrole ujemne na zmutowanej treści).
 */

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const DECISION = 'Decyzja produktowa: portal ogłoszeniowy (#1128)';
const DOC_MARKER = /(Wyłączone w trybie ogłoszeniowym|Tryb ogłoszeniowy) \(#1128\)/;

/** Sub-issues epiku #1128 — każdy musi mieć punkt w liście kontrolnej trybu. */
const SUB_ISSUES = Array.from({ length: 1153 - 1129 + 1 }, (_, i) => 1129 + i).concat(1154);

const MARKED_DOCS = [
  'docs/GUEST_APPLY.md',
  'docs/AI_CV_IMPORT.md',
  'docs/JOB_FUNNEL.md',
  'docs/ARCHITECTURE.md',
];

function hasDecision(text: string): boolean {
  return text.includes(DECISION);
}

function hasInvariant(claude: string): boolean {
  return /^13\. \*\*Tryb ogłoszeniowy \(#1128\)\.\*\*/m.test(claude);
}

/** Sekcja §1c listy kontrolnej (do następnego nagłówka `##`/`###`). */
function modeSection(checklist: string): string {
  const start = checklist.indexOf('### 1c. Tryb ogłoszeniowy (#1128)');
  if (start < 0) return '';
  const rest = checklist.slice(start + 1);
  const end = rest.search(/\n#{2,3} /);
  return end < 0 ? rest : rest.slice(0, end);
}

function missingIssues(section: string): number[] {
  return SUB_ISSUES.filter((n) => !new RegExp(`#${n}\\b`).test(section));
}

/** Nazwy przepisów/urzędów nie wchodzą do dokumentów trybu (repo publiczne). */
const LEGAL_NAMES = /\b(RODO|GDPR|AVG|RGPD|DSA|AI Act|art\.\s?\d|ustaw[aey]|dyrektyw|rozporządzeni|urz[ąę]d|inspekcj|FOD|SPF|VDAB|Forem|Actiris)\b/i;

describe('zapis decyzji „portal ogłoszeniowy” (#1154)', () => {
  const claude = read('CLAUDE.md');
  const decisions = read('docs/PRODUCT_DECISIONS.md');
  const checklist = read('docs/LAUNCH_CHECKLIST.md');

  it('CLAUDE.md i PRODUCT_DECISIONS.md mają znacznik decyzji', () => {
    expect(hasDecision(claude)).toBe(true);
    expect(hasDecision(decisions)).toBe(true);
    expect(hasInvariant(claude)).toBe(true);
  });

  it('LAUNCH_CHECKLIST.md §1c odsyła do każdego sub-issue #1128', () => {
    const section = modeSection(checklist);
    expect(section.length).toBeGreaterThan(0);
    expect(missingIssues(section)).toEqual([]);
  });

  it.each(MARKED_DOCS)('%s ma nagłówek trybu', (doc) => {
    const head = read(doc).split('\n').slice(0, 8).join('\n');
    expect(head).toMatch(DOC_MARKER);
  });

  it('wpis decyzji i sekcja trybu bez nazw przepisów i urzędów', () => {
    const entry = decisions.slice(decisions.indexOf('## 2026-09-28: portal ogłoszeniowy'));
    expect(entry).not.toMatch(LEGAL_NAMES);
    expect(modeSection(checklist)).not.toMatch(LEGAL_NAMES);
  });

  describe('kontrole ujemne', () => {
    it('usunięty znacznik decyzji = czerwony', () => {
      expect(hasDecision(claude.replaceAll(DECISION, 'Decyzja'))).toBe(false);
      expect(hasDecision(decisions.replaceAll(DECISION, ''))).toBe(false);
      expect(hasInvariant(claude.replace(/^13\. \*\*Tryb ogłoszeniowy/m, '13. **Coś innego'))).toBe(false);
    });

    it('brak punktu sub-issue w §1c = czerwony', () => {
      const section = modeSection(checklist).replaceAll('#1134', '#0000');
      expect(missingIssues(section)).toEqual([1134]);
      expect(modeSection(checklist.replace('### 1c. Tryb ogłoszeniowy (#1128)', '### 1c. Inne'))).toBe('');
    });

    it('nagłówek bez znacznika trybu = czerwony; nazwa przepisu wykrywana', () => {
      expect('# Aplikacja bez konta (#98)\n\nGość może…').not.toMatch(DOC_MARKER);
      expect('zgodnie z RODO').toMatch(LEGAL_NAMES);
    });
  });
});

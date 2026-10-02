// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  normalizeShiftPatterns,
  parseShiftPatternsParam,
  SHIFT_PATTERNS,
  shiftPatternsMatch,
} from '@/lib/job-shift-patterns';
import {
  countActiveSidebar,
  emptySidebarFilters,
  flattenSearchParams,
  parseSidebarFilters,
  refinementQueryParams,
  sidebarFiltersToParams,
} from '@/components/public/job-filters';
import { parseJobListQuery, savedSearchFiltersFromQuery, savedSearchQueryString } from '@/lib/job-list-query';
import { describeJobListFilters, savedSearchFilterLabels } from '@/lib/job-filter-summary';
import { buildDraftStepContent } from '@/lib/job-draft-content';
import { step2Schema } from '@/lib/validation/job';
import { getJobs } from '@/lib/jobs';

/**
 * #858 (0227): strukturalny grafik pracy oferty — lista wartości wspólna z bazą, parametr
 * adresu `shift`, zapisane wyszukiwanie `shiftPatterns`, zapis kroku 2 kreatora i filtr
 * danych demo (lustro warunku SQL `&&`).
 */

const MIGRATION = readFileSync(
  path.join(process.cwd(), 'supabase', 'migrations', '0227_job_shift_patterns.sql'),
  'utf8',
);
const MESSAGES = ['pl', 'nl', 'fr', 'en'].map((locale) => ({
  locale,
  json: JSON.parse(readFileSync(path.join(process.cwd(), 'src', 'messages', `${locale}.json`), 'utf8')) as {
    filters: { shiftPatternValues: Record<string, string> };
  },
}));

const t = {
  filters: (key: string) => `filters.${key}`,
  categories: (key: string) => key,
  contractTypes: (key: string) => key,
  languageNames: (key: string) => key,
  benefits: (key: string) => key,
};

describe('0227: lista wartości = baza', () => {
  it('job_shift_pattern_values() w migracji = SHIFT_PATTERNS (ta sama kolejność)', () => {
    const match = MIGRATION.match(/select array\[([^\]]+)\]::text\[\];/);
    expect(match).not.toBeNull();
    const sqlValues = match![1]!.split(',').map((v) => v.trim().replace(/^'|'$/g, ''));
    expect(sqlValues).toEqual([...SHIFT_PATTERNS]);
  });

  it('każda wartość ma etykietę we wszystkich czterech językach', () => {
    for (const { locale, json } of MESSAGES) {
      expect(Object.keys(json.filters.shiftPatternValues).sort(), locale).toEqual([...SHIFT_PATTERNS].sort());
    }
  });

  it('filtr w liście, liczniku, facetach i kopii alertów (4 warunki)', () => {
    const conditions = MIGRATION.match(/or j\.shift_patterns && p_shift_patterns\)/g) ?? [];
    expect(conditions).toHaveLength(4);
  });
});

describe('0227: reguły TS', () => {
  it('normalizacja: kolejność listy, bez duplikatów i nieznanych wartości', () => {
    expect(normalizeShiftPatterns(['night', 'day', 'night', 'nope'])).toEqual(['day', 'night']);
    expect(normalizeShiftPatterns(undefined)).toEqual([]);
    expect(parseShiftPatternsParam('weekend, day,xx')).toEqual(['day', 'weekend']);
    expect(parseShiftPatternsParam(undefined)).toEqual([]);
  });

  it('dopasowanie = którykolwiek typ; bez deklaracji nie pasuje (kontrola ujemna)', () => {
    expect(shiftPatternsMatch(['night', 'weekend'], ['day', 'weekend'])).toBe(true);
    expect(shiftPatternsMatch(['night'], ['day'])).toBe(false);
    expect(shiftPatternsMatch(undefined, ['day'])).toBe(false);
    expect(shiftPatternsMatch([], ['day'])).toBe(false);
    expect(shiftPatternsMatch(undefined, [])).toBe(true);
  });
});

describe('0227: adres listy, chipy i zapisane wyszukiwanie', () => {
  it('parametr `shift` (CSV) ↔ filtry panelu, także powtórzony klucz bez JS', () => {
    const f = parseSidebarFilters(flattenSearchParams({ shift: ['weekend', 'day'] }));
    expect(f.shiftPatterns).toEqual(['day', 'weekend']);
    expect(sidebarFiltersToParams(f)['shift']).toBe('day,weekend');
    expect(countActiveSidebar(f)).toBe(2);
    expect(refinementQueryParams(f)).toEqual({ shiftPatterns: ['day', 'weekend'] });
    // Kontrola ujemna: bez filtra nie ma parametru ani klucza w zapytaniu.
    expect(sidebarFiltersToParams(emptySidebarFilters())['shift']).toBeUndefined();
    expect(refinementQueryParams(emptySidebarFilters())).toEqual({});
  });

  it('chip na każdą wartość z usunięciem pojedynczej wartości', () => {
    const query = parseJobListQuery({ shift: 'night,day' }, 'pl');
    const chips = describeJobListFilters(query, 'pl', t).filter((c) => c.id.startsWith('shift-'));
    expect(chips).toEqual([
      { id: 'shift-day', label: 'filters.shiftPatternValues.day', removeKey: 'shift', removeValue: 'day' },
      { id: 'shift-night', label: 'filters.shiftPatternValues.night', removeKey: 'shift', removeValue: 'night' },
    ]);
  });

  it('zapisane wyszukiwanie przechowuje `shiftPatterns` i adres z `shift`', () => {
    const query = parseJobListQuery({ shift: 'weekend,day' }, 'pl');
    expect(query.filterParams.shiftPatterns).toEqual(['day', 'weekend']);
    expect(savedSearchFiltersFromQuery(query)).toEqual({ shiftPatterns: ['day', 'weekend'] });
    const qs = savedSearchQueryString(query);
    expect(qs).toContain('shift=day%2Cweekend');
    expect(savedSearchFilterLabels(qs, 'pl', t)).toEqual([
      'filters.shiftPatternValues.day',
      'filters.shiftPatternValues.weekend',
    ]);
  });
});

describe('0227: kreator — krok 2', () => {
  const base = { contractType: 'permanent', workingHours: '38 h', startImmediately: false };

  it('zapis kroku niesie `shift_patterns` (pusta lista = brak deklaracji)', () => {
    const parsed = step2Schema.parse({ ...base, shiftPatterns: ['night', 'day'] });
    expect((buildDraftStepContent(2, parsed)!.job as Record<string, unknown>)['shift_patterns']).toEqual(['day', 'night']);
    const empty = step2Schema.parse(base);
    expect((buildDraftStepContent(2, empty)!.job as Record<string, unknown>)['shift_patterns']).toEqual([]);
  });

  it('kontrola ujemna: wartość spoza listy odrzucona przez schemat', () => {
    expect(step2Schema.safeParse({ ...base, shiftPatterns: ['nights'] }).success).toBe(false);
  });
});

describe('0227: dane demo filtrują jak SQL', () => {
  it('praca weekendowa: tylko oferty z deklaracją weekendu', async () => {
    const all = await getJobs({ locale: 'pl', pageSize: 100 });
    const weekend = await getJobs({ locale: 'pl', shiftPatterns: ['weekend'], pageSize: 100 });
    expect(weekend.jobs.length).toBeGreaterThan(0);
    expect(weekend.jobs.length).toBeLessThan(all.jobs.length);
  });
});

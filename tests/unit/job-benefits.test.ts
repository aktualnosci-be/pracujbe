// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  countActiveSidebar,
  emptySidebarFilters,
  flattenSearchParams,
  parseSidebarFilters,
  refinementQueryParams,
  sidebarFiltersToParams,
} from '@/components/public/job-filters';
import {
  benefitsMatch,
  effectiveBenefitCodes,
  JOB_BENEFIT_CODES,
  normalizeBenefitCodes,
  parseJobBenefitsRow,
} from '@/lib/job-benefits';
import { jobCostsPatch } from '@/lib/job-costs';
import { buildDraftStepContent } from '@/lib/job-draft-content';
import { describeJobListFilters, type FilterSummaryTranslators } from '@/lib/job-filter-summary';
import { parseJobListQuery, savedSearchFiltersFromQuery, savedSearchQueryString } from '@/lib/job-list-query';
import { getJobs } from '@/lib/jobs';
import { step8Schema } from '@/lib/validation/job';
import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import nl from '@/messages/nl.json';
import pl from '@/messages/pl.json';

/**
 * Strukturalne świadczenia oferty (#826, migracja 0229 — numer tymczasowy). Lustro TS bazy:
 * katalog kodów, świadczenia efektywne (z bonami i zwrotem dojazdu z 0169), filtr „każde
 * wybrane”, adres URL, zapisane wyszukiwanie, zapis kroku 8 kreatora. Kontrole ujemne
 * pokazują, że każdy element naprawdę zawęża albo odrzuca.
 */

const MIGRATIONS_DIR = path.join(process.cwd(), 'supabase/migrations');
const MIGRATION = readFileSync(
  path.join(MIGRATIONS_DIR, readdirSync(MIGRATIONS_DIR).find((f) => f.endsWith('_job_benefits.sql'))!),
  'utf8',
);

function sqlCatalog(sql: string): string[] {
  const body = /function public\.job_benefit_catalog\(\)[\s\S]*?select array\[([^\]]*)\]::text\[\]/.exec(sql);
  if (!body) throw new Error('brak job_benefit_catalog() w migracji');
  return [...body[1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
}

describe('#826 katalog świadczeń: TS = SQL, etykiety w 4 językach', () => {
  it('kody i kolejność jak `job_benefit_catalog()`', () => {
    expect(sqlCatalog(MIGRATION)).toEqual([...JOB_BENEFIT_CODES]);
    // Kontrola ujemna: parser naprawdę czyta listę z SQL (zmieniona lista ≠ katalog TS).
    expect(sqlCatalog(MIGRATION.replace("'training', ", ''))).not.toEqual([...JOB_BENEFIT_CODES]);
  });

  it('każdy kod ma niepustą etykietę w PL/NL/FR/EN (bez kodów spoza katalogu)', () => {
    for (const messages of [pl, nl, fr, en]) {
      const labels = (messages as { jobBenefits: Record<string, string> }).jobBenefits;
      expect(Object.keys(labels).sort()).toEqual([...JOB_BENEFIT_CODES].sort());
      for (const code of JOB_BENEFIT_CODES) expect(labels[code]?.trim()).toBeTruthy();
    }
  });
});

describe('#826 świadczenia efektywne (lustro `job_effective_benefits`)', () => {
  it('kody + bony z kwoty i zwrot dojazdu z 0169, porządek katalogu, bez powtórzeń', () => {
    expect(effectiveBenefitCodes({ codes: [], transportReimbursed: true, mealVoucherDaily: 8 })).toEqual([
      'meal_vouchers',
      'commute_allowance',
    ]);
    expect(effectiveBenefitCodes({ codes: ['training', 'meal_vouchers'], mealVoucherDaily: 5 })).toEqual([
      'meal_vouchers',
      'training',
    ]);
    expect(effectiveBenefitCodes({ codes: null, transportReimbursed: null, mealVoucherDaily: null })).toEqual([]);
    // Kontrola ujemna: brak kwoty i brak zwrotu = brak pochodnych (nie zgadujemy).
    expect(effectiveBenefitCodes({ codes: ['training'], transportReimbursed: false })).toEqual(['training']);
  });

  it('filtr: oferta ma KAŻDE wybrane świadczenie; pusta lista = bez filtra', () => {
    expect(benefitsMatch(['eco_vouchers', 'training'], ['eco_vouchers'])).toBe(true);
    expect(benefitsMatch(['eco_vouchers', 'training'], ['eco_vouchers', 'training'])).toBe(true);
    expect(benefitsMatch(['eco_vouchers'], ['eco_vouchers', 'company_car'])).toBe(false);
    expect(benefitsMatch([], [])).toBe(true);
    expect(benefitsMatch([], ['training'])).toBe(false);
  });

  it('normalizacja i parser wiersza RPC odrzucają nieznane wartości', () => {
    expect(normalizeBenefitCodes(['training', 'free_beer', 'eco_vouchers', 'training', 7])).toEqual([
      'eco_vouchers',
      'training',
    ]);
    expect(parseJobBenefitsRow({ codes: ['company_car', 'x'], other: ['  Karta sportowa ', '', 3] })).toEqual({
      codes: ['company_car'],
      other: ['Karta sportowa'],
    });
    expect(parseJobBenefitsRow(null)).toBeUndefined();
  });
});

describe('#826 filtr listy: URL, parametry RPC, chipy, zapisane wyszukiwanie', () => {
  it('URL `benefits` (CSV i powtórzony klucz bez JS) → filtr w porządku katalogu', () => {
    const f = parseSidebarFilters({ benefits: 'training,free_beer,eco_vouchers,training' });
    expect(f.benefits).toEqual(['eco_vouchers', 'training']);
    expect(sidebarFiltersToParams(f)['benefits']).toBe('eco_vouchers,training');
    expect(countActiveSidebar(f)).toBe(2);
    const noJs = parseSidebarFilters(flattenSearchParams({ benefits: ['company_car', 'meal_vouchers'] }));
    expect(noJs.benefits).toEqual(['meal_vouchers', 'company_car']);
    // Kontrola ujemna: brak parametru = brak filtra (nic w adresie ani w RPC).
    const empty = emptySidebarFilters();
    expect(sidebarFiltersToParams(empty)['benefits']).toBeUndefined();
    expect(refinementQueryParams(empty).benefits).toBeUndefined();
  });

  it('parametry listy i zapisanego wyszukiwania niosą świadczenia (klucz kanoniczny `benefits`)', () => {
    const query = parseJobListQuery({ benefits: 'training,eco_vouchers' }, 'pl');
    expect(query.filterParams.benefits).toEqual(['eco_vouchers', 'training']);
    expect(savedSearchFiltersFromQuery(query)).toEqual({ benefits: ['eco_vouchers', 'training'] });
    expect(savedSearchQueryString(query)).toBe('?benefits=eco_vouchers%2Ctraining');
    expect(savedSearchFiltersFromQuery(parseJobListQuery({}, 'pl')).benefits).toBeUndefined();
  });

  it('chipy: jedna pozycja na świadczenie, z wartością do usunięcia', () => {
    const make = (ns: string) => (key: string) => `${ns}.${key}`;
    const t: FilterSummaryTranslators = {
      filters: make('filters'),
      categories: make('categories'),
      contractTypes: make('contractTypes'),
      languageNames: make('languageNames'),
      benefits: make('jobBenefits'),
    };
    const items = describeJobListFilters(parseJobListQuery({ benefits: 'company_car,training' }, 'pl'), 'pl', t);
    expect(items).toEqual([
      { id: 'benefit-company_car', label: 'jobBenefits.company_car', removeKey: 'benefits', removeValue: 'company_car' },
      { id: 'benefit-training', label: 'jobBenefits.training', removeKey: 'benefits', removeValue: 'training' },
    ]);
  });

  it('lustro demo (`getJobs` bez bazy): filtr zawęża wynik (kontrola ujemna: bez filtra więcej)', async () => {
    const base = { locale: 'pl' as const, page: 1, pageSize: 100 };
    const all = await getJobs(base);
    const eco = await getJobs({ ...base, benefits: ['eco_vouchers'] });
    expect(eco.total).toBeGreaterThan(0);
    expect(eco.total).toBeLessThan(all.total);
    // Bony z kwoty w „Kosztach i dodatkach” (oferta 1001) liczą się bez zaznaczonego kodu.
    const meal = await getJobs({ ...base, benefits: ['meal_vouchers'] });
    expect(meal.jobs.map((j) => j.id)).toEqual(expect.arrayContaining(['1001', '1002']));
    const both = await getJobs({ ...base, benefits: ['eco_vouchers', 'company_car'] });
    expect(both.total).toBe(0);
  });
});

describe('#826 kreator: krok 8 zapisuje świadczenia z katalogu', () => {
  it('schemat przyjmuje kody katalogu, odrzuca nieznane; patch niesie `benefit_codes`', () => {
    const parsed = step8Schema.parse({ benefitCodes: ['training', 'eco_vouchers'] });
    expect(jobCostsPatch(parsed).benefit_codes).toEqual(['eco_vouchers', 'training']);
    const content = buildDraftStepContent(8, parsed) as { job: Record<string, unknown> };
    expect(content.job['benefit_codes']).toEqual(['eco_vouchers', 'training']);
    // Brak zaznaczeń = pusta lista (czyści zapis; „nie podano”).
    expect(jobCostsPatch(step8Schema.parse({})).benefit_codes).toEqual([]);
    expect(step8Schema.safeParse({ benefitCodes: ['free_beer'] }).success).toBe(false);
  });

  it('save_job_draft i update_published_job przyjmują klucz `benefit_codes` (SQL migracji)', () => {
    const draft = MIGRATION.slice(MIGRATION.indexOf('create or replace function public.save_job_draft('));
    expect(draft).toContain("'benefit_codes')");
    expect(draft).toContain('benefit_codes            = case when j ? \'benefit_codes\'');
    const published = MIGRATION.slice(MIGRATION.indexOf('create or replace function public.update_published_job('));
    expect(published).toContain("benefit_codes            = public.job_benefit_codes_from_jsonb(j->'benefit_codes')");
  });
});

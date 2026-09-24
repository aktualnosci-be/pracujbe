import { describe, expect, it } from 'vitest';
import {
  emptySidebarFilters,
  matchesSidebar,
  sortJobs,
  type FacetItem,
} from '@/components/public/job-filters';
import {
  monthlySalary,
  salaryInMonthlyRange,
  type SalaryFields,
} from '@/lib/salary-compare';

// Zestaw z kryteriów #188 + kontrole ujemne; reguła ma być identyczna z SQL 0080
// (supabase/tests/rls.sql, sekcja SAL).
type Job = SalaryFields & { slug: string; publishedAt: string };
const at = (hoursAgo: number) =>
  new Date(Date.UTC(2026, 8, 24, 12) - hoursAgo * 3_600_000).toISOString();
const jobs: Job[] = [
  { slug: 'hour', salaryMin: 20, salaryMax: 22, salaryPeriod: 'hour', publishedAt: at(5) },
  { slug: 'month', salaryMin: 3000, salaryPeriod: 'month', publishedAt: at(1) },
  { slug: 'year', salaryMin: 36000, salaryPeriod: 'year', publishedAt: at(2) },
  { slug: 'year-low', salaryMin: 24000, salaryPeriod: 'year', publishedAt: at(4) },
  { slug: 'month-low', salaryMin: 2000, salaryPeriod: 'month', publishedAt: at(3) },
  { slug: 'none', publishedAt: at(6) },
];
const slugs = (list: readonly Job[]) => list.map((job) => job.slug);

describe('monthlySalary', () => {
  it('miesiąc bez zmian, rok / 12, godzina bez przeliczenia', () => {
    expect(monthlySalary(3000, 'month')).toBe(3000);
    expect(monthlySalary(36000, 'year')).toBe(3000);
    expect(monthlySalary(20, 'hour')).toBeUndefined();
    expect(monthlySalary(undefined, 'month')).toBeUndefined();
  });

  it('brak okresu = miesiąc (domyślna wartość kolumny jobs.salary_period)', () => {
    expect(monthlySalary(2500, undefined)).toBe(2500);
  });
});

describe('filtr od 2500 EUR/mies.', () => {
  const kept = jobs.filter((job) => salaryInMonthlyRange(job, 2500, Infinity));

  it('porównuje ekwiwalent miesięczny, zostawia nieporównywalne', () => {
    expect(slugs(kept).sort()).toEqual(['hour', 'month', 'none', 'year']);
  });

  it('kontrola ujemna: roczne 24 000 (=2000/mies.) odpada mimo 24 000 > 2500', () => {
    expect(slugs(kept)).not.toContain('year-low');
  });

  it('górna granica: roczne 36 000 (=3000/mies.) odpada przy filtrze do 2500', () => {
    const upTo = jobs.filter((job) => salaryInMonthlyRange(job, 0, 2500));
    expect(slugs(upTo).sort()).toEqual(['hour', 'month-low', 'none', 'year-low']);
  });

  it('stawka godzinowa nie jest przeliczana niezależnie od wymiaru czasu pracy', () => {
    for (const rate of [12, 20, 45]) {
      expect(salaryInMonthlyRange({ salaryMin: rate, salaryPeriod: 'hour' }, 2500, 2600)).toBe(true);
    }
  });
});

describe('sortowanie „najwyższe wynagrodzenie”', () => {
  it('po ekwiwalencie miesięcznym, remis → nowsze, nieporównywalne na końcu', () => {
    expect(slugs(sortJobs(jobs, 'salary'))).toEqual([
      'month',
      'year',
      'month-low',
      'year-low',
      'hour',
      'none',
    ]);
  });
});

describe('matchesSidebar (liczniki demo) stosuje tę samą regułę', () => {
  const item = (job: Job): FacetItem => ({
    category: 'warehouse',
    city: 'Mechelen',
    contractType: 'permanent',
    ...job,
    accommodation: false,
    immediate: false,
    noLanguageRequired: false,
  });

  it('od 2500 EUR/mies. — ten sam wynik co filtr listy', () => {
    const f = { ...emptySidebarFilters(), salaryMin: 2500 };
    expect(jobs.filter((job) => matchesSidebar(item(job), f)).map((j) => j.slug).sort())
      .toEqual(['hour', 'month', 'none', 'year']);
  });
});

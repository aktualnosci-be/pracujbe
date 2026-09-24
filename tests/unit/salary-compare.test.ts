import { describe, expect, it } from 'vitest';
import {
  emptySidebarFilters,
  matchesSidebar,
  parseSidebarFilters,
  salaryQueryParams,
  sidebarFiltersToParams,
  sortJobs,
  withSalaryUnit,
  type FacetItem,
} from '@/components/public/job-filters';
import {
  comparableSalary,
  monthlySalary,
  salaryInMonthlyRange,
  salaryInRange,
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

// Jednostka godzinowa (0091, rls.sql sekcja SP188): stawki godzinowe porównywane wprost,
// miesięczne/roczne nieprzeliczane na godziny (nieznana liczba godzin pracy).
const hourlyJobs: Job[] = [
  ...jobs,
  // Te same 14 EUR/godz. przy różnych wymiarach czasu pracy — wymiar nie zmienia wyniku.
  { slug: 'hour-part', salaryMin: 14, salaryPeriod: 'hour', publishedAt: at(7) },
  { slug: 'hour-full', salaryMin: 14, salaryMax: 16, salaryPeriod: 'hour', publishedAt: at(8) },
];

describe('comparableSalary', () => {
  it('month: rok / 12, godzina nieporównywalna; hour: tylko stawka godzinowa', () => {
    expect(comparableSalary(36000, 'year', 'month')).toBe(3000);
    expect(comparableSalary(20, 'hour', 'month')).toBeUndefined();
    expect(comparableSalary(20, 'hour', 'hour')).toBe(20);
    expect(comparableSalary(3000, 'month', 'hour')).toBeUndefined();
    expect(comparableSalary(36000, 'year', 'hour')).toBeUndefined();
    // Brak okresu = month, więc w jednostce godzinowej nieporównywalny.
    expect(comparableSalary(18, undefined, 'hour')).toBeUndefined();
  });

  it('domyślna jednostka = month (zachowanie 0080)', () => {
    expect(comparableSalary(36000, 'year')).toBe(3000);
  });
});

describe('filtr od 18 EUR/godz.', () => {
  const kept = hourlyJobs.filter((job) => salaryInRange(job, 18, Infinity, 'hour'));

  it('porównuje stawki godzinowe, miesięczne/roczne i bez kwoty zostają', () => {
    expect(slugs(kept).sort()).toEqual([
      'hour', 'month', 'month-low', 'none', 'year', 'year-low',
    ]);
  });

  it('kontrola ujemna: 14–16 EUR/godz. odpada niezależnie od wymiaru czasu pracy', () => {
    expect(slugs(kept)).not.toContain('hour-part');
    expect(slugs(kept)).not.toContain('hour-full');
  });

  it('kontrola ujemna: w jednostce miesięcznej ten sam próg 18 nie wyklucza nikogo', () => {
    expect(hourlyJobs.every((job) => salaryInMonthlyRange(job, 18, Infinity))).toBe(true);
  });
});

describe('sortowanie po stawce godzinowej', () => {
  it('stawki godzinowe malejąco, remis → nowsze, pozostałe na końcu wg daty', () => {
    expect(slugs(sortJobs(hourlyJobs, 'salary', 'hour'))).toEqual([
      'hour',
      'hour-full',
      'hour-part',
      'month',
      'year',
      'month-low',
      'year-low',
      'none',
    ]);
  });
});

describe('parametry filtra jednostki', () => {
  it('URL salaryUnit=hour: widełki godzinowe, parametry RPC z jednostką', () => {
    const f = parseSidebarFilters({ salaryUnit: 'hour', salaryMin: '18', salaryMax: '40' });
    expect(f).toMatchObject({ salaryUnit: 'hour', salaryMin: 18, salaryMax: 40 });
    // Górna granica suwaka = „i więcej” → bez salaryMax.
    expect(salaryQueryParams(f)).toEqual({ salaryUnit: 'hour', salaryMin: 18 });
    expect(sidebarFiltersToParams(f)).toMatchObject({
      salaryUnit: 'hour', salaryMin: '18', salaryMax: '40',
    });
  });

  it('nieznana jednostka → month; kwoty przycinane do widełek jednostki', () => {
    expect(parseSidebarFilters({ salaryUnit: 'week' }).salaryUnit).toBe('month');
    expect(parseSidebarFilters({ salaryUnit: 'hour', salaryMin: '2500' }).salaryMin).toBe(40);
  });

  it('puste pola kwot (formularz bez JS) = pełne widełki, bez zawężenia', () => {
    const f = parseSidebarFilters({ salaryUnit: 'hour', salaryMin: '', salaryMax: '' });
    expect(salaryQueryParams(f)).toEqual({ salaryUnit: 'hour' });
  });

  it('zmiana jednostki zeruje widełki (bez przeliczania kwot)', () => {
    const f = withSalaryUnit({ ...emptySidebarFilters(), salaryMin: 2500 }, 'hour');
    expect(f).toMatchObject({ salaryUnit: 'hour', salaryMin: 10, salaryMax: 40 });
    expect(sidebarFiltersToParams(f)).toEqual({ salaryUnit: 'hour' });
  });

  it('liczniki demo (matchesSidebar) — ten sam wynik co filtr listy w jednostce godzinowej', () => {
    const f = { ...withSalaryUnit(emptySidebarFilters(), 'hour'), salaryMin: 18 };
    const facet = (job: Job): FacetItem => ({
      category: 'warehouse', city: 'Mechelen', contractType: 'permanent', ...job,
      accommodation: false, immediate: false, noLanguageRequired: false,
    });
    expect(hourlyJobs.filter((job) => matchesSidebar(facet(job), f)).map((j) => j.slug).sort())
      .toEqual(['hour', 'month', 'month-low', 'none', 'year', 'year-low']);
  });
});

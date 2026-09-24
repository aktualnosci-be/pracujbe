/**
 * Porównywanie wynagrodzeń na liście ofert (#188) — lustro reguły SQL z migracji
 * `0080_salary_period_filter.sql` i `0092_salary_unit_filter.sql` (`job_comparable_salary`,
 * `job_salary_in_range`, `job_salary_sort_key`). Moduł czysty: używa go ścieżka demo
 * `getJobs` oraz klienckie liczniki filtrów, więc widok demonstracyjny i PostgreSQL liczą
 * tak samo.
 *
 * Filtr i sortowanie działają w wybranej jednostce (`SalaryUnit`):
 * - `month` (domyślnie, EUR brutto/mies.): `month` → kwota, `year` → kwota / 12,
 *   `hour` → nieporównywalna;
 * - `hour` (EUR brutto/godz.): `hour` → kwota, `month`/`year` → nieporównywalne.
 * Stawek godzinowych i miesięcznych nie przeliczamy na siebie: godziny pracy to wolny
 * tekst, a 160 h/mies. nie pasuje do niepełnego wymiaru ani zmiennych godzin.
 * Brak okresu = `month` (domyślna wartość kolumny `jobs.salary_period`).
 * Oferta bez porównywalnej kwoty nie odpada z filtra kwoty i trafia na koniec sortowania.
 */

import type { SalaryPeriod } from '@/lib/jobs';

/** Jednostka filtra i sortowania wynagrodzeń (`p_salary_unit` w SQL). */
export type SalaryUnit = 'month' | 'hour';
export const SALARY_UNITS: readonly SalaryUnit[] = ['month', 'hour'];

export function isSalaryUnit(value: unknown): value is SalaryUnit {
  return value === 'month' || value === 'hour';
}

export interface SalaryFields {
  salaryMin?: number;
  salaryMax?: number;
  salaryPeriod?: SalaryPeriod;
}

/** Miesięczny ekwiwalent kwoty albo `undefined`, gdy kwoty nie da się porównać. */
export function monthlySalary(
  amount: number | undefined,
  period: SalaryPeriod | undefined,
): number | undefined {
  if (amount === undefined) return undefined;
  switch (period ?? 'month') {
    case 'month':
      return amount;
    case 'year':
      return amount / 12;
    default:
      return undefined;
  }
}

/** Kwota w wybranej jednostce albo `undefined`, gdy oferta jest w niej nieporównywalna. */
export function comparableSalary(
  amount: number | undefined,
  period: SalaryPeriod | undefined,
  unit: SalaryUnit = 'month',
): number | undefined {
  if (unit === 'hour') return period === 'hour' ? amount : undefined;
  return monthlySalary(amount, period);
}

/** Klucz sortowania „najwyższe wynagrodzenie” (górna kwota w wybranej jednostce). */
export function salarySortKey(
  job: SalaryFields,
  unit: SalaryUnit = 'month',
): number | undefined {
  return comparableSalary(job.salaryMax ?? job.salaryMin, job.salaryPeriod, unit);
}

/** Klucz sortowania w jednostce miesięcznej (zachowanie 0080). */
export function monthlySalarySortKey(job: SalaryFields): number | undefined {
  return salarySortKey(job, 'month');
}

/**
 * Czy oferta mieści się w widełkach filtra w wybranej jednostce. `hi` = `Infinity`
 * oznacza „i więcej”. Oferta bez porównywalnej kwoty zawsze przechodzi.
 */
export function salaryInRange(
  job: SalaryFields,
  lo: number,
  hi: number,
  unit: SalaryUnit = 'month',
): boolean {
  const top = comparableSalary(job.salaryMax ?? job.salaryMin, job.salaryPeriod, unit);
  const bottom = comparableSalary(job.salaryMin ?? job.salaryMax, job.salaryPeriod, unit);
  if (top === undefined || bottom === undefined) return true;
  return top >= lo && bottom <= hi;
}

/** Widełki miesięczne (zachowanie 0080). */
export function salaryInMonthlyRange(
  job: SalaryFields,
  lo: number,
  hi: number,
): boolean {
  return salaryInRange(job, lo, hi, 'month');
}

/** Komparator malejący po kluczu wynagrodzenia; oferty bez klucza na końcu. */
export function compareSalaryDesc(
  a: SalaryFields,
  b: SalaryFields,
  unit: SalaryUnit = 'month',
): number {
  const ka = salarySortKey(a, unit);
  const kb = salarySortKey(b, unit);
  if (ka === undefined && kb === undefined) return 0;
  if (ka === undefined) return 1;
  if (kb === undefined) return -1;
  return kb - ka;
}

/** Komparator w jednostce miesięcznej (zachowanie 0080). */
export function compareMonthlySalaryDesc(a: SalaryFields, b: SalaryFields): number {
  return compareSalaryDesc(a, b, 'month');
}

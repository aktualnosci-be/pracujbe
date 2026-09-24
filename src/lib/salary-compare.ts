/**
 * Porównywanie wynagrodzeń na liście ofert (#188) — lustro reguły SQL z migracji
 * `0080_salary_period_filter.sql` (`job_monthly_salary`, `job_salary_in_monthly_range`,
 * `job_monthly_salary_sort_key`). Moduł czysty: używa go ścieżka demo `getJobs` oraz
 * klienckie liczniki filtrów, więc widok demonstracyjny i PostgreSQL liczą tak samo.
 *
 * Suwak jest w EUR brutto/miesiąc:
 * - `month` → kwota bez zmian,
 * - `year` → kwota / 12,
 * - `hour` → brak przeliczenia (godziny pracy nie są znane w sposób wiarygodny).
 * Brak okresu = `month` (domyślna wartość kolumny `jobs.salary_period`).
 * Oferta bez porównywalnej kwoty nie odpada z filtra kwoty i trafia na koniec sortowania.
 */

import type { SalaryPeriod } from '@/lib/jobs';

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

/** Klucz sortowania „najwyższe wynagrodzenie” (miesięczny ekwiwalent górnej kwoty). */
export function monthlySalarySortKey(job: SalaryFields): number | undefined {
  return monthlySalary(job.salaryMax ?? job.salaryMin, job.salaryPeriod);
}

/**
 * Czy oferta mieści się w miesięcznych widełkach filtra. `hi` = `Infinity` oznacza
 * „i więcej”. Oferta bez porównywalnej kwoty zawsze przechodzi.
 */
export function salaryInMonthlyRange(
  job: SalaryFields,
  lo: number,
  hi: number,
): boolean {
  const top = monthlySalary(job.salaryMax ?? job.salaryMin, job.salaryPeriod);
  const bottom = monthlySalary(job.salaryMin ?? job.salaryMax, job.salaryPeriod);
  if (top === undefined || bottom === undefined) return true;
  return top >= lo && bottom <= hi;
}

/** Komparator malejący po kluczu wynagrodzenia; oferty bez klucza na końcu. */
export function compareMonthlySalaryDesc(
  a: SalaryFields,
  b: SalaryFields,
): number {
  const ka = monthlySalarySortKey(a);
  const kb = monthlySalarySortKey(b);
  if (ka === undefined && kb === undefined) return 0;
  if (ka === undefined) return 1;
  if (kb === undefined) return -1;
  return kb - ka;
}

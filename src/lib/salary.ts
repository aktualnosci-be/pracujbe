import type { SalaryPeriod } from '@/lib/jobs';

/** Wspólny zapis widełek i okresu na liście, szczegółach oraz w podobnych ofertach. */
export function formatSalaryRange(
  salary: { salaryMin?: number; salaryMax?: number; currency: string; salaryPeriod: SalaryPeriod },
  locale: string,
  labels: { from: (value: string) => string; to: (value: string) => string; period: (period: SalaryPeriod) => string },
): string | null {
  const format = new Intl.NumberFormat(locale, {
    style: 'currency', currency: salary.currency || 'EUR',
    minimumFractionDigits: 0, maximumFractionDigits: 2,
  });
  let amount: string | null = null;
  if (salary.salaryMin !== undefined && salary.salaryMax !== undefined) amount = `${format.format(salary.salaryMin)} – ${format.format(salary.salaryMax)}`;
  else if (salary.salaryMin !== undefined) amount = labels.from(format.format(salary.salaryMin));
  else if (salary.salaryMax !== undefined) amount = labels.to(format.format(salary.salaryMax));
  return amount === null ? null : `${amount} ${labels.period(salary.salaryPeriod)}`;
}

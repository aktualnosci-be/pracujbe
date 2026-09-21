/** Wspólny zapis widełek na liście i szczegółach; nie zgaduje okresu ani brakującej granicy. */
export function formatSalaryRange(
  salary: { salaryMin?: number; salaryMax?: number; currency: string },
  locale: string,
  labels: { from: (value: string) => string; to: (value: string) => string },
): string | null {
  const format = new Intl.NumberFormat(locale, {
    style: 'currency', currency: salary.currency || 'EUR',
    minimumFractionDigits: 0, maximumFractionDigits: 2,
  });
  if (salary.salaryMin !== undefined && salary.salaryMax !== undefined) {
    return `${format.format(salary.salaryMin)} – ${format.format(salary.salaryMax)}`;
  }
  if (salary.salaryMin !== undefined) return labels.from(format.format(salary.salaryMin));
  if (salary.salaryMax !== undefined) return labels.to(format.format(salary.salaryMax));
  return null;
}

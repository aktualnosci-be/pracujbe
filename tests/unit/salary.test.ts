import { expect, it, vi } from 'vitest';
import { formatSalaryRange } from '@/lib/salary';

const labels = { from: (value: string) => `from ${value}`, to: (value: string) => `to ${value}`,
  period: (period: 'hour' | 'month' | 'year') => `gross/${period}` };
it.each(['pl', 'nl', 'fr', 'en'])('zachowuje grosze, znaczenie granic i okres w %s', locale => {
  const number = (value: number) => new Intl.NumberFormat(locale, {
    style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2,
  }).format(value);
  expect(formatSalaryRange({ currency: 'EUR', salaryMin: 18.75, salaryMax: 22.5, salaryPeriod: 'hour' }, locale, labels))
    .toBe(`${number(18.75)} – ${number(22.5)} gross/hour`);
  expect(formatSalaryRange({ currency: 'EUR', salaryMin: 18.75, salaryPeriod: 'month' }, locale, labels)).toBe(`from ${number(18.75)} gross/month`);
  expect(formatSalaryRange({ currency: 'EUR', salaryMax: 22.5, salaryPeriod: 'year' }, locale, labels)).toBe(`to ${number(22.5)} gross/year`);
  expect(formatSalaryRange({ currency: 'EUR', salaryMin: 0, salaryPeriod: 'hour' }, locale, labels)).toBe(`from ${number(0)} gross/hour`);
  expect(formatSalaryRange({ currency: 'EUR', salaryPeriod: 'month' }, locale, labels)).toBeNull();
});

it('bez rozpoznanego okresu zachowuje kwotę bez sufiksu i nie próbuje tłumaczyć okresu', () => {
  const period = vi.fn(labels.period);
  const result = formatSalaryRange({ currency: 'EUR', salaryMin: 18.75 }, 'en', { ...labels, period });

  expect(result).toBe('from €18.75');
  expect(result).not.toContain('month');
  expect(period).not.toHaveBeenCalled();
});

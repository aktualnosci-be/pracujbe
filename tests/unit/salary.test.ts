import { expect, it } from 'vitest';
import { formatSalaryRange } from '@/lib/salary';

const labels = { from: (value: string) => `from ${value}`, to: (value: string) => `to ${value}` };
it.each(['pl', 'nl', 'fr', 'en'])('zachowuje grosze i znaczenie granic w %s', locale => {
  const number = (value: number) => new Intl.NumberFormat(locale, {
    style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2,
  }).format(value);
  expect(formatSalaryRange({ currency: 'EUR', salaryMin: 18.75, salaryMax: 22.5 }, locale, labels))
    .toBe(`${number(18.75)} – ${number(22.5)}`);
  expect(formatSalaryRange({ currency: 'EUR', salaryMin: 18.75 }, locale, labels)).toBe(`from ${number(18.75)}`);
  expect(formatSalaryRange({ currency: 'EUR', salaryMax: 22.5 }, locale, labels)).toBe(`to ${number(22.5)}`);
  expect(formatSalaryRange({ currency: 'EUR', salaryMin: 0 }, locale, labels)).toBe(`from ${number(0)}`);
  expect(formatSalaryRange({ currency: 'EUR' }, locale, labels)).toBeNull();
});

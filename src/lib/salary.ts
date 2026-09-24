import type { SalaryPeriod } from '@/lib/jobs';

/**
 * Jedno źródło zapisu wynagrodzenia (#22): karta oferty, szczegół, podobne oferty, JobPosting
 * JSON-LD i e-maile korzystają z `normalizeSalary`, a tekst buduje `formatSalaryRange`.
 *
 * Reguły:
 * - kwoty z dokładnością do dwóch miejsc; gdy którakolwiek granica ma grosze, obie są
 *   pokazane z dwoma miejscami (18,75 nie staje się 19, a 22,5 → 22,50),
 * - jedna granica = etykieta „od”/„do”; min = max → jedna kwota,
 * - brak kwoty = brak pola (bez zastępczej „do negocjacji”),
 * - okres tylko z danych oferty — bez zgadywania (brak okresu = brak sufiksu). Przeliczanie
 *   okresów do porównań na liście ofert to osobna reguła w `salary-compare.ts` (#188),
 * - liczby i waluta w locale strony (albo odbiorcy e-maila).
 */

export interface SalaryInput {
  salaryMin?: number | null;
  salaryMax?: number | null;
  currency?: string | null;
  salaryPeriod?: SalaryPeriod | null;
}

export interface NormalizedSalary {
  min?: number;
  max?: number;
  currency: string;
  period?: SalaryPeriod;
}

export interface SalaryLabels {
  from: (value: string) => string;
  to: (value: string) => string;
  period: (period: SalaryPeriod) => string;
}

const DEFAULT_CURRENCY = 'EUR';

function validAmount(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function validCurrency(value: string | null | undefined): string {
  const code = value?.trim().toUpperCase();
  if (!code || !/^[A-Z]{3}$/.test(code)) return DEFAULT_CURRENCY;
  try {
    new Intl.NumberFormat('en', { style: 'currency', currency: code });
    return code;
  } catch {
    return DEFAULT_CURRENCY;
  }
}

function isSalaryPeriod(value: unknown): value is SalaryPeriod {
  return value === 'hour' || value === 'month' || value === 'year';
}

/**
 * Oczyszczone widełki albo `null`, gdy oferta nie ma żadnej kwoty. Kwota ujemna lub
 * nieskończona jest pomijana; odwrócone widełki są porządkowane.
 */
export function normalizeSalary(salary: SalaryInput): NormalizedSalary | null {
  let min = validAmount(salary.salaryMin);
  let max = validAmount(salary.salaryMax);
  if (min === undefined && max === undefined) return null;
  if (min !== undefined && max !== undefined && min > max) [min, max] = [max, min];
  const period = isSalaryPeriod(salary.salaryPeriod) ? salary.salaryPeriod : undefined;
  return {
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
    currency: validCurrency(salary.currency),
    ...(period ? { period } : {}),
  };
}

const hasCents = (value: number | undefined): boolean =>
  value !== undefined && Math.round(value * 100) % 100 !== 0;

/** Wspólny zapis widełek i okresu na liście, szczegółach, w podobnych ofertach i e-mailach. */
export function formatSalaryRange(salary: SalaryInput, locale: string, labels: SalaryLabels): string | null {
  const normalized = normalizeSalary(salary);
  if (normalized === null) return null;
  const { min, max, currency, period } = normalized;
  const digits = hasCents(min) || hasCents(max) ? 2 : 0;
  const format = new Intl.NumberFormat(locale, {
    style: 'currency', currency,
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  });
  let amount: string;
  if (min !== undefined && max !== undefined) {
    // min = max: jedna konkretna kwota, bez „od”/„do”.
    amount = min === max ? format.format(min) : `${format.format(min)} – ${format.format(max)}`;
  } else if (min !== undefined) amount = labels.from(format.format(min));
  else amount = labels.to(format.format(max!));
  return period ? `${amount} ${labels.period(period)}` : amount;
}

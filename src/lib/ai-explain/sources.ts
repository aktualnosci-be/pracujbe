import type { Locale } from '@/i18n/routing';
import { jobStartInfo } from '@/lib/job-start';
import type { JobCosts } from '@/lib/job-costs';
import { normalizeSalary } from '@/lib/salary';
import { ALL_SENSITIVE_KINDS, redactSensitiveData } from '@/lib/privacy/sensitive-data';

/**
 * Źródła wyjaśnienia oferty (#773) — treść JEDNEJ publicznej oferty pocięta na krótkie,
 * ponumerowane fragmenty (`S1`, `S2`, …). Model może objaśniać wyłącznie te fragmenty i musi
 * wskazać, z których wynika każde objaśnienie; serwer porównuje fakty objaśnienia z faktami
 * wskazanych fragmentów (`guard.ts`).
 *
 * Do modelu nie trafiają: dane kandydata, kanał aplikowania, opis firmy, e-maile, telefony
 * i identyfikatory (zastąpione znacznikiem, `redactSensitiveData`). Pola strukturalne
 * (wynagrodzenie, umowa, miejsce, start, zakwaterowanie…) idą do modelu jako krótkie zdania
 * po angielsku (`modelText`, fakty liczone w `en`), a użytkownik widzi tę samą wartość
 * sformatowaną w języku strony (`display`). Fragmenty tekstu użytkownik widzi w oryginale.
 *
 * Moduł czysty (bez `server-only`) — testowany jednostkowo.
 */

export const EXPLAIN_SOURCE_FIELDS = [
  'title',
  'salary',
  'contract',
  'location',
  'start',
  'workTime',
  'workingHours',
  'shifts',
  'accommodation',
  'transport',
  'mealVouchers',
  'languages',
  'description',
  'responsibilities',
  'requirementsMandatory',
  'requirementsOptional',
  'conditions',
] as const;
export type ExplainSourceField = (typeof EXPLAIN_SOURCE_FIELDS)[number];

export interface ExplainSource {
  /** `S1`, `S2`, … — kolejność jak na stronie oferty. */
  id: string;
  field: ExplainSourceField;
  /** Tekst dla modelu (po redakcji danych kontaktowych i identyfikatorów). */
  modelText: string;
  /** Język `modelText` — do ekstrakcji faktów (pola strukturalne: `en`). */
  factLocale: Locale;
  /** To, co widzi użytkownik jako źródło objaśnienia. */
  display: string;
  /** Język `display` (oryginał oferty albo język strony dla pól strukturalnych). */
  displayLocale: Locale;
}

/** Najwięcej fragmentów i znaków wysyłanych do modelu (górna granica kosztu). */
export const EXPLAIN_MAX_SOURCES = 120;
export const EXPLAIN_MAX_SOURCE_CHARS = 600;
export const EXPLAIN_MAX_TOTAL_CHARS = 12_000;

/** Dane oferty potrzebne do źródeł (podzbiór `JobDetail`). */
export interface ExplainJobInput {
  title: string;
  city: string;
  region: string;
  contractType: string;
  salaryMin?: number;
  salaryMax?: number;
  currency: string;
  salaryPeriod?: 'hour' | 'month' | 'year';
  immediate: boolean;
  startDate?: string;
  accommodation: boolean;
  transport: boolean;
  noLanguageRequired: boolean;
  languages: string[];
  workTime?: string;
  workingHours: string;
  shifts?: string;
  description: string;
  responsibilities: string[];
  requirementsMandatory: string[];
  requirementsOptional: string[];
  conditions: string[];
  costs?: JobCosts;
}

/** Wartości pól strukturalnych w języku strony (formatuje akcja — tłumaczenia next-intl). */
export interface ExplainDisplayValues {
  salary: string | null;
  contract: string;
  location: string;
  start: string | null;
  workTime: string | null;
  accommodation: string | null;
  transport: string | null;
  mealVouchers: string | null;
  languages: string | null;
}

/** Zdania i wiersze opisu (jak `splitSentences` w kontroli faktów tłumaczeń). */
export function splitExplainSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+|\n+/u)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function clip(text: string): string {
  return text.length > EXPLAIN_MAX_SOURCE_CHARS ? `${text.slice(0, EXPLAIN_MAX_SOURCE_CHARS - 1)}…` : text;
}

function redact(text: string): string {
  return redactSensitiveData(text, ALL_SENSITIVE_KINDS).text;
}

function num(value: number): string {
  // Bez separatorów tysięcy — ekstrakcja faktów porównuje liczby kanonicznie.
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/** Zdania po angielsku dla pól strukturalnych (fakty liczone w `en`). */
export function structuredModelTexts(job: ExplainJobInput): Partial<Record<ExplainSourceField, string>> {
  const out: Partial<Record<ExplainSourceField, string>> = {};
  // Te same reguły co zapis kwot na stronie (`normalizeSalary`: bez kwot ujemnych, porządek widełek).
  const salary = normalizeSalary(job);
  if (salary) {
    const { min, max } = salary;
    const range =
      min !== undefined && max !== undefined && min !== max
        ? `from ${num(min)} to ${num(max)}`
        : min !== undefined && max === undefined
          ? `from ${num(min)}`
          : min === undefined && max !== undefined
            ? `up to ${num(max)}`
            : num(min ?? max ?? 0);
    const period = salary.period ? ` per ${salary.period}` : '';
    out.salary = `Salary stated by the employer: ${range} ${salary.currency}${period}`;
  }
  out.contract = `Contract type: ${job.contractType.replace(/_/g, ' ')}`;
  out.location = `Place of work: ${[job.city, job.region].filter(Boolean).join(', ')}`;
  const start = jobStartInfo(job);
  if (start.immediate || start.date) {
    out.start = [start.immediate ? 'Start: immediately' : null, start.date ? `Start date: ${start.date}` : null]
      .filter(Boolean)
      .join('. ');
  }
  if (job.workTime) out.workTime = `Working time: ${job.workTime.replace(/_/g, ' ')}`;
  const costs = job.costs;
  if (costs?.accommodationKind) {
    const parts = [`Accommodation: ${costs.accommodationKind === 'assistance' ? 'help finding accommodation' : costs.accommodationKind === 'provided' ? 'provided by the employer' : 'none'}`];
    if (costs.accommodationCost !== undefined) {
      parts.push(`Accommodation cost: ${num(costs.accommodationCost)} EUR${costs.accommodationCostPeriod ? ` per ${costs.accommodationCostPeriod}` : ''}`);
    }
    if (costs.accommodationDeducted !== undefined) {
      parts.push(`Deducted from wages: ${costs.accommodationDeducted ? 'yes' : 'no'}`);
    }
    out.accommodation = parts.join('. ');
  } else if (job.accommodation) {
    out.accommodation = 'Accommodation: offered';
  }
  if (costs?.transportShuttle || costs?.transportReimbursed) {
    out.transport = [
      costs.transportShuttle ? 'Transport to work: shuttle organised by the employer' : null,
      costs.transportReimbursed ? 'Travel costs: reimbursed' : null,
    ]
      .filter(Boolean)
      .join('. ');
  } else if (job.transport) {
    out.transport = 'Transport to work: offered';
  }
  if (costs?.mealVoucherDaily !== undefined) out.mealVouchers = `Meal vouchers: ${num(costs.mealVoucherDaily)} EUR per day`;
  if (job.languages.length > 0) out.languages = `Required languages: ${job.languages.join(', ')}`;
  else if (job.noLanguageRequired) out.languages = 'Language requirement: none';
  return out;
}

/**
 * Buduje ponumerowane źródła. Kolejność = kolejność pól na stronie oferty; łączny rozmiar
 * ograniczony `EXPLAIN_MAX_TOTAL_CHARS` (dalsze fragmenty są pomijane, a nie obcinane w połowie).
 */
export function buildExplainSources(
  job: ExplainJobInput,
  contentLocale: Locale,
  pageLocale: Locale,
  display: ExplainDisplayValues,
): ExplainSource[] {
  const structured = structuredModelTexts(job);
  const raw: Omit<ExplainSource, 'id'>[] = [];
  const text = (field: ExplainSourceField, value: string) => {
    const display = value.replace(/\s+/g, ' ').trim();
    if (!display) return;
    raw.push({ field, modelText: clip(redact(display)), factLocale: contentLocale, display: clip(display), displayLocale: contentLocale });
  };
  const field = (key: ExplainSourceField & keyof ExplainDisplayValues) => {
    const modelText = structured[key];
    const shown = display[key];
    if (!modelText || !shown) return;
    raw.push({ field: key, modelText, factLocale: 'en', display: shown, displayLocale: pageLocale });
  };

  text('title', job.title);
  field('salary');
  field('contract');
  field('location');
  field('start');
  field('workTime');
  text('workingHours', job.workingHours);
  if (job.shifts) text('shifts', job.shifts);
  field('accommodation');
  field('transport');
  field('mealVouchers');
  field('languages');
  for (const sentence of splitExplainSentences(job.description)) text('description', sentence);
  for (const item of job.responsibilities) text('responsibilities', item);
  for (const item of job.requirementsMandatory) text('requirementsMandatory', item);
  for (const item of job.requirementsOptional) text('requirementsOptional', item);
  for (const item of job.conditions) text('conditions', item);

  const out: ExplainSource[] = [];
  let total = 0;
  for (const source of raw) {
    if (out.length >= EXPLAIN_MAX_SOURCES) break;
    if (total + source.modelText.length > EXPLAIN_MAX_TOTAL_CHARS) break;
    total += source.modelText.length;
    out.push({ id: `S${out.length + 1}`, ...source });
  }
  return out;
}

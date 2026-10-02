/**
 * Porównanie warunków zapisanych ofert (#816): 2–3 oferty w jednym widoku.
 *
 * Wejście: identyfikatory z adresu (`?porownaj=`), stan zapisanych ofert kandydata (`SavedJob`,
 * 0162) i szczegóły oferty dostępnej publicznie (`JobDetail`). Wynik: kolumny (oferty) i wiersze
 * (warunki) z jawnym „brak danych” — bez przeliczania walut i okresów stawek, bez zgadywania.
 * Deterministyczne, bez AI; czysta logika (teksty przychodzą z wywołującego).
 */

import { buildJobCostItems, type JobCostLabels } from '@/lib/job-costs';
import type { JobDetail } from '@/lib/jobs';
import { formatSalaryRange, type SalaryLabels } from '@/lib/salary';
import type { SavedJob, SavedJobAvailability } from '@/lib/saved-job-availability';
import type { Locale } from '@/i18n/routing';

export const MAX_COMPARE_JOBS = 3;
export const MIN_COMPARE_JOBS = 2;
/** Ile wymagań obowiązkowych pokazuje wiersz „Kluczowe wymagania”. */
export const COMPARE_REQUIREMENTS_LIMIT = 5;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CompareSelection {
  /** Identyfikatory zapisanych ofert do porównania (unikalne, w kolejności z adresu, ≤ 3). */
  ids: string[];
  /** Adres zawierał więcej niż 3 oferty (nadmiar pominięty). */
  truncated: boolean;
  /** Adres w ogóle prosił o porównanie (parametr obecny). */
  requested: boolean;
}

/**
 * `?porownaj=` (powtórzony klucz albo lista po przecinku) → wybór ograniczony do zapisanych ofert
 * kandydata. Obce/niepoprawne identyfikatory są pomijane — nie da się porównać cudzej oferty.
 */
export function parseCompareSelection(
  raw: string | string[] | undefined,
  savedIds: ReadonlySet<string>,
): CompareSelection {
  if (raw === undefined) return { ids: [], truncated: false, requested: false };
  const parts = (Array.isArray(raw) ? raw : [raw]).flatMap((value) => value.split(','));
  const unique: string[] = [];
  for (const part of parts) {
    const id = part.trim().toLowerCase();
    if (!UUID_RE.test(id) || !savedIds.has(id) || unique.includes(id)) continue;
    unique.push(id);
  }
  return { ids: unique.slice(0, MAX_COMPARE_JOBS), truncated: unique.length > MAX_COMPARE_JOBS, requested: true };
}

export type CompareLoad =
  | { status: 'ok'; detail: JobDetail }
  | { status: 'unavailable' }
  | { status: 'error' };

export interface CompareColumn {
  id: string;
  title: string;
  companyName: string;
  city: string;
  /** Adres szczegółów — tylko oferta dostępna publicznie. */
  slug: string | null;
  /** `available` = szczegóły wczytane; inaczej stan zapisu (zamknięta, wygasła…) albo błąd odczytu. */
  state: 'available' | Exclude<SavedJobAvailability, 'available'> | 'error';
}

export type CompareCell =
  | { kind: 'text'; lines: string[] }
  | { kind: 'list'; items: string[] }
  /** Oferta nie podała tej informacji. */
  | { kind: 'none' }
  /** Oferta niedostępna — warunków nie da się pokazać. */
  | { kind: 'unavailable' };

export type CompareRowKey =
  | 'salary' | 'contract' | 'hours' | 'shifts' | 'accommodation' | 'transport' | 'requirements';

export interface CompareRow {
  key: CompareRowKey;
  cells: CompareCell[];
}

export interface CompareModel {
  columns: CompareColumn[];
  rows: CompareRow[];
}

export interface CompareFormatters {
  locale: Locale;
  salaryLabels: SalaryLabels;
  contract: (type: JobDetail['contractType']) => string;
  costLabels: JobCostLabels;
}

const ROW_KEYS: readonly CompareRowKey[] = [
  'salary', 'contract', 'hours', 'shifts', 'accommodation', 'transport', 'requirements',
];

function textCell(value: string | undefined | null): CompareCell {
  const text = (value ?? '').trim();
  return text ? { kind: 'text', lines: [text] } : { kind: 'none' };
}

function detailCell(key: CompareRowKey, job: JobDetail, f: CompareFormatters): CompareCell {
  switch (key) {
    case 'salary': {
      // Waluta i okres zostają z oferty (bez przeliczeń); oferta bez kwoty = brak danych.
      const text = formatSalaryRange(
        { salaryMin: job.salaryMin, salaryMax: job.salaryMax, currency: job.currency, salaryPeriod: job.salaryPeriod },
        f.locale,
        f.salaryLabels,
      );
      return textCell(text);
    }
    case 'contract':
      return textCell(job.contractType ? f.contract(job.contractType) : null);
    case 'hours':
      return textCell(job.workingHours);
    case 'shifts':
      return textCell(job.shifts);
    case 'accommodation':
    case 'transport': {
      const item = buildJobCostItems(job, f.costLabels, f.locale).find((entry) => entry.key === key);
      return item ? { kind: 'text', lines: [item.value, ...item.details] } : { kind: 'none' };
    }
    case 'requirements': {
      const items = job.requirementsMandatory
        .map((value) => value.trim())
        .filter(Boolean)
        .slice(0, COMPARE_REQUIREMENTS_LIMIT);
      return items.length > 0 ? { kind: 'list', items } : { kind: 'none' };
    }
  }
}

/**
 * Kolumny i wiersze porównania. `saved` = własne zapisy kandydata (kolejność kolumn = kolejność
 * `ids`); `loads[id]` = wynik odczytu szczegółów dla oferty dostępnej (brak wpisu = błąd odczytu).
 */
export function buildCompareModel(
  ids: readonly string[],
  saved: readonly SavedJob[],
  loads: Readonly<Record<string, CompareLoad | undefined>>,
  formatters: CompareFormatters,
): CompareModel {
  const byId = new Map(saved.map((job) => [job.id.toLowerCase(), job]));
  const columns: CompareColumn[] = [];
  const details: Array<JobDetail | null> = [];

  for (const id of ids) {
    const job = byId.get(id.toLowerCase());
    if (!job) continue;
    const load = job.availability === 'available' ? (loads[id] ?? { status: 'error' as const }) : null;
    if (load && load.status === 'ok') {
      columns.push({
        id: job.id, title: load.detail.title || job.title, companyName: load.detail.companyName || job.companyName,
        city: load.detail.city || job.city, slug: job.slug ?? load.detail.slug, state: 'available',
      });
      details.push(load.detail);
      continue;
    }
    columns.push({
      id: job.id, title: job.title, companyName: job.companyName, city: job.city, slug: null,
      // Oferta dostępna w zapisie, ale bez szczegółów: zniknęła w międzyczasie albo odczyt zawiódł.
      state: job.availability !== 'available' ? job.availability : load?.status === 'unavailable' ? 'unavailable' : 'error',
    });
    details.push(null);
  }

  const rows: CompareRow[] = ROW_KEYS.map((key) => ({
    key,
    cells: details.map((detail): CompareCell => (detail ? detailCell(key, detail, formatters) : { kind: 'unavailable' })),
  }));
  return { columns, rows };
}

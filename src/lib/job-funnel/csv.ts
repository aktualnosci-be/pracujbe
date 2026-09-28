/**
 * Eksport lejka ofert (#99) do CSV — formatowanie bez dostępu do bazy.
 *
 * Kolumny = to, co pokazuje `/employer/statystyki`: zakres dat (dni Europe/Brussels, włącznie),
 * tytuł oferty, status (etykieta w języku panelu) i cztery liczniki (tryb ogłoszeniowy #1147: trzy —
 * bez wysłanych aplikacji; `applyStarted` = kliknięcia „Aplikuj u pracodawcy”). Ostatni wiersz = suma
 * zakresu. Liczby surowe (bez separatorów tysięcy), żeby arkusz liczył je jako liczby.
 * Komórki przez `csvCell` (RFC 4180 + neutralizacja formuł `= + - @` — tytuł oferty wpisuje
 * pracodawca). Separator `,`, koniec linii CRLF, BOM UTF-8 dla arkuszy.
 *
 * Tylko agregaty per oferta — lejek nie zawiera danych osób (0089), eksport też nie.
 */
import { csvCell } from '@/lib/admin/breach';
import type { FunnelDateRange } from '@/lib/job-funnel/range';

export interface JobFunnelCsvMetrics {
  searchAppearances: number;
  detailViews: number;
  applyStarted: number;
  /** Brak pola = tryb ogłoszeniowy (#1147): CSV bez kolumny wysłanych aplikacji. */
  applicationsSubmitted?: number;
}

export interface JobFunnelCsvJob extends JobFunnelCsvMetrics {
  title: string;
  status: string;
}

export interface JobFunnelCsvLabels {
  from: string;
  to: string;
  offer: string;
  status: string;
  searchAppearances: string;
  detailViews: string;
  applyStarted: string;
  /** Wymagane tylko w trybie rekrutacyjnym (kolumna istnieje). */
  applicationsSubmitted?: string;
  total: string;
  untitled: string;
  /** Etykieta statusu oferty w języku panelu; nieznany status → ''. */
  statusLabel: (status: string) => string;
}

const METRIC_KEYS = ['searchAppearances', 'detailViews', 'applyStarted', 'applicationsSubmitted'] as const;
/** Tryb ogłoszeniowy (#1147): bez kolumny wysłanych aplikacji. */
const LISTING_METRIC_KEYS = ['searchAppearances', 'detailViews', 'applyStarted'] as const;

function count(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function row(cells: readonly unknown[]): string {
  return cells.map(csvCell).join(',');
}

export function jobFunnelCsv(
  range: Pick<FunnelDateRange, 'from' | 'to'>,
  jobs: readonly JobFunnelCsvJob[],
  totals: JobFunnelCsvMetrics,
  labels: JobFunnelCsvLabels,
): string {
  const keys = totals.applicationsSubmitted === undefined ? LISTING_METRIC_KEYS : METRIC_KEYS;
  const lines = [
    row([labels.from, labels.to, labels.offer, labels.status, ...keys.map((key) => labels[key] ?? '')]),
    ...jobs.map((job) =>
      row([
        range.from,
        range.to,
        job.title.trim() || labels.untitled,
        labels.statusLabel(job.status),
        ...keys.map((key) => count(job[key])),
      ])),
    row([range.from, range.to, labels.total, '', ...keys.map((key) => count(totals[key]))]),
  ];
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** Nazwa pliku bez treści oferty i bez nazwy firmy — sam zakres dat. */
export function jobFunnelCsvFilename(range: Pick<FunnelDateRange, 'from' | 'to'>): string {
  return `job-funnel-${range.from}_${range.to}.csv`;
}

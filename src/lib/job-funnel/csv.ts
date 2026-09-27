/**
 * Eksport lejka ofert (#99) do CSV — formatowanie bez dostępu do bazy.
 *
 * Kolumny = to, co pokazuje `/employer/statystyki`: zakres dat (dni Europe/Brussels, włącznie),
 * tytuł oferty, status (etykieta w języku panelu) i cztery liczniki. Ostatni wiersz = suma
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
  applicationsSubmitted: number;
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
  applicationsSubmitted: string;
  total: string;
  untitled: string;
  /** Etykieta statusu oferty w języku panelu; nieznany status → ''. */
  statusLabel: (status: string) => string;
}

const METRIC_KEYS = ['searchAppearances', 'detailViews', 'applyStarted', 'applicationsSubmitted'] as const;

function count(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
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
  const lines = [
    row([labels.from, labels.to, labels.offer, labels.status, ...METRIC_KEYS.map((key) => labels[key])]),
    ...jobs.map((job) =>
      row([
        range.from,
        range.to,
        job.title.trim() || labels.untitled,
        labels.statusLabel(job.status),
        ...METRIC_KEYS.map((key) => count(job[key])),
      ])),
    row([range.from, range.to, labels.total, '', ...METRIC_KEYS.map((key) => count(totals[key]))]),
  ];
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** Nazwa pliku bez treści oferty i bez nazwy firmy — sam zakres dat. */
export function jobFunnelCsvFilename(range: Pick<FunnelDateRange, 'from' | 'to'>): string {
  return `job-funnel-${range.from}_${range.to}.csv`;
}

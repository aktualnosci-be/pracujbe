import * as React from 'react';

import { Link } from '@/i18n/navigation';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableRowHeader } from '@/components/ui/table';
import { BTN_SECONDARY, H2_EXTENDED, PAPER, TABLE_WRAP } from '@/components/dashboard/panel-styles';
import type { CompareCell, CompareModel, CompareRowKey } from '@/lib/saved-job-compare';
import { cn } from '@/lib/utils';

/**
 * Wspólny widok warunków 2–3 zapisanych ofert (#816). Komponent serwerowy (zero JS): tabela
 * z prawdziwymi nagłówkami kolumn (oferty) i wierszy (warunki), przewijana poziomo na wąskim
 * ekranie w regionie dostępnym z klawiatury (`tabIndex=0`, nazwa). Brak danych i niedostępna
 * oferta są oznaczone jawnie; waluta i okres stawki pochodzą z oferty (bez przeliczeń). Teksty
 * przychodzą przetłumaczone.
 */
export interface SavedJobsComparisonLabels {
  title: string;
  caption: string;
  offerColumn: string;
  noData: string;
  unavailableCell: string;
  viewOffer: string;
  close: string;
  detailsError: string;
  rows: Record<CompareRowKey, string>;
  /** Etykieta stanu oferty niedostępnej (zamknięta, wygasła…) wg stanu kolumny. */
  state: (state: Exclude<CompareModel['columns'][number]['state'], 'available' | 'error'>) => string;
}

function Cell({ cell, labels }: { cell: CompareCell; labels: SavedJobsComparisonLabels }): React.JSX.Element {
  switch (cell.kind) {
    case 'text':
      return (
        <>
          {cell.lines.map((line, index) => (
            <span key={index} className={cn('block break-words', index > 0 && 'mt-1 text-[12px] text-muted-foreground')}>
              {line}
            </span>
          ))}
        </>
      );
    case 'list':
      return (
        <ul className="list-disc space-y-1 pl-4">
          {cell.items.map((item, index) => (
            <li key={index} className="break-words">{item}</li>
          ))}
        </ul>
      );
    case 'none':
      return <span className="text-muted-foreground">{labels.noData}</span>;
    case 'unavailable':
      return <span className="text-muted-foreground">{labels.unavailableCell}</span>;
  }
}

export function SavedJobsComparison({
  model,
  labels,
  closeHref,
  headingId,
}: {
  model: CompareModel;
  labels: SavedJobsComparisonLabels;
  closeHref: string;
  headingId: string;
}): React.JSX.Element {
  return (
    <section className={cn(PAPER, 'mb-[25px] min-w-0')} aria-labelledby={headingId} id="porownanie">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <h2 id={headingId} className={H2_EXTENDED}>{labels.title}</h2>
        <Link href={closeHref} scroll={false} className={cn(BTN_SECONDARY, 'min-h-11 shrink-0 px-[17px] py-[11px] text-xs')}>
          {labels.close}
        </Link>
      </div>
      <div className={cn(TABLE_WRAP, 'relative mt-4')} role="region" aria-label={labels.caption} tabIndex={0}>
        <Table className="min-w-[560px] table-fixed">
          <caption className="sr-only">{labels.caption}</caption>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[28%]"><span className="sr-only">{labels.offerColumn}</span></TableHead>
              {model.columns.map((column) => (
                <TableHead key={column.id} className="whitespace-normal align-top text-[13px] text-foreground">
                  {column.slug ? (
                    <Link href={`/oferty-pracy/${column.slug}`} className="font-semibold text-accent underline-offset-4 hover:underline">
                      {column.title}
                      <span className="sr-only"> — {labels.viewOffer}</span>
                    </Link>
                  ) : (
                    <span className="font-semibold">{column.title}</span>
                  )}
                  <span className="mt-1 block font-normal text-muted-foreground">
                    {[column.companyName, column.city].filter(Boolean).join(' · ')}
                  </span>
                  {column.state !== 'available' ? (
                    <span className="mt-1 block font-normal text-error-text">
                      {column.state === 'error' ? labels.detailsError : labels.state(column.state)}
                    </span>
                  ) : null}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {model.rows.map((row) => (
              <TableRow key={row.key}>
                <TableRowHeader className="align-top font-semibold">{labels.rows[row.key]}</TableRowHeader>
                {row.cells.map((cell, index) => (
                  <TableCell key={model.columns[index]!.id} wrap className="align-top">
                    <Cell cell={cell} labels={labels} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

import * as React from 'react';

import { TD, TD_WRAP, TH } from '@/components/dashboard/panel-styles';
import { cn } from '@/lib/utils';

/**
 * Table (shadcn-style API) w stylu `.table-wrap table` prototypu „Ludzie i praca”.
 *
 * Domyślne klasy komórek = `TH`/`TD`/`TD_WRAP` z `panel-styles.ts`, więc podmiana ręcznej
 * tabeli nie zmienia wyglądu. W odróżnieniu od shadcn `Table` nie owija tabeli w przewijany
 * `div` (robi to wywołujący klasą `TABLE_WRAP`, często z wariantem tylko dla desktopu)
 * i nie dodaje `hover`/obramowań wierszy — prototyp ich nie ma.
 * Komponent serwerowy: zero JS w przeglądarce.
 */
const Table = React.forwardRef<HTMLTableElement, React.TableHTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <table ref={ref} className={cn('w-full border-collapse', className)} {...props} />
  ),
);
Table.displayName = 'Table';

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>((props, ref) => <thead ref={ref} {...props} />);
TableHeader.displayName = 'TableHeader';

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>((props, ref) => <tbody ref={ref} {...props} />);
TableBody.displayName = 'TableBody';

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  (props, ref) => <tr ref={ref} {...props} />,
);
TableRow.displayName = 'TableRow';

/** Nagłówek kolumny: `<th scope="col">` z klasą `TH`. */
const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, scope = 'col', ...props }, ref) => (
  <th ref={ref} scope={scope} className={cn(TH, className)} {...props} />
));
TableHead.displayName = 'TableHead';

export interface TableCellProps extends React.TdHTMLAttributes<HTMLTableCellElement> {
  /** Treść może się zawijać (długie nazwy) — klasa `TD_WRAP` zamiast `TD`. */
  wrap?: boolean;
}

/** Komórka danych: `<td>` z klasą `TD` (albo `TD_WRAP` przy `wrap`). */
const TableCell = React.forwardRef<HTMLTableCellElement, TableCellProps>(
  ({ className, wrap = false, ...props }, ref) => (
    <td ref={ref} className={cn(wrap ? TD_WRAP : TD, className)} {...props} />
  ),
);
TableCell.displayName = 'TableCell';

export interface TableRowHeaderProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  /** Treść może się zawijać — domyślnie tak (kolumna nazwy). */
  wrap?: boolean;
}

/** Nagłówek wiersza (np. nazwa firmy): `<th scope="row">` wyglądający jak komórka danych. */
const TableRowHeader = React.forwardRef<HTMLTableCellElement, TableRowHeaderProps>(
  ({ className, wrap = true, ...props }, ref) => (
    <th
      ref={ref}
      scope="row"
      className={cn(wrap ? TD_WRAP : TD, 'text-left font-normal', className)}
      {...props}
    />
  ),
);
TableRowHeader.displayName = 'TableRowHeader';

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableRowHeader };

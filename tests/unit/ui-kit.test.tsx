import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { NOTICE, TD, TD_WRAP, TH } from '@/components/dashboard/panel-styles';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Pagination, PaginationContent, PaginationItem } from '@/components/ui/pagination';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableRowHeader,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

/**
 * Zestaw shadcn/ui w stylu „Ludzie i praca” (Etap 1). Komponenty zastępują ręczne tabele,
 * szkielety, stronicowanie i komunikaty — podmiana nie może zmienić klas kalki prototypu.
 */
describe('ui/table', () => {
  it('daje dokładnie klasy TH/TD/TD_WRAP z panel-styles i semantykę nagłówków', () => {
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nazwa</TableHead>
            <TableHead className="pr-0 text-right">Akcje</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableRowHeader>Firma A</TableRowHeader>
            <TableCell>ok</TableCell>
            <TableCell wrap>długa nazwa</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    const table = screen.getByRole('table');
    expect(table.className).toBe('w-full border-collapse');
    const [name, actions] = within(table).getAllByRole('columnheader');
    expect(name).toHaveAttribute('scope', 'col');
    expect(name!.className).toBe(cn(TH));
    expect(actions!.className).toBe(cn(TH, 'pr-0 text-right'));
    const rowHeader = within(table).getByRole('rowheader', { name: 'Firma A' });
    expect(rowHeader).toHaveAttribute('scope', 'row');
    expect(rowHeader.className).toBe(cn(TD_WRAP, 'text-left font-normal'));
    const [cell, wrapped] = within(table).getAllByRole('cell');
    expect(cell!.className).toBe(cn(TD));
    expect(wrapped!.className).toBe(cn(TD_WRAP));
    // Kontrola ujemna: komórka bez `wrap` nie może się zawijać, z `wrap` — tak.
    expect(cell!.className).toContain('whitespace-nowrap');
    expect(wrapped!.className).not.toContain('whitespace-nowrap');
  });
});

describe('ui/skeleton', () => {
  it('jest dekoracyjny i pulsuje tylko przy motion-safe', () => {
    const { container } = render(<Skeleton className="h-16 rounded-xl" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el).toHaveAttribute('aria-hidden', 'true');
    expect(el.className).toContain('motion-safe:animate-pulse');
    expect(el.className.split(' ')).not.toContain('animate-pulse');
    expect(el.className).toContain('bg-soft');
    expect(el.className).toContain('rounded-xl');
    expect(el.className).not.toContain('rounded-md');
  });
});

describe('ui/pagination', () => {
  it('jest nazwanym landmarkiem z listą pozycji', () => {
    render(
      <Pagination aria-label="Strony">
        <PaginationContent>
          <PaginationItem>
            <a href="?cursor=x">Dalej</a>
          </PaginationItem>
        </PaginationContent>
      </Pagination>,
    );
    const nav = screen.getByRole('navigation', { name: 'Strony' });
    expect(within(nav).getAllByRole('listitem')).toHaveLength(1);
    expect(within(nav).getByRole('link', { name: 'Dalej' })).toBeVisible();
  });
});

describe('ui/alert', () => {
  it('wariant error ma role="alert" i kolory błędu z tokenów', () => {
    render(<Alert variant="error">Błąd zapisu</Alert>);
    const alert = screen.getByRole('alert');
    expect(alert.className).toBe(cn(NOTICE, 'my-0 border-error/30 bg-error/10 text-error-text'));
  });

  it('notatka nie ma roli alertu (kontrola ujemna), rola z propsa wygrywa', () => {
    const { rerender } = render(
      <Alert>
        <AlertDescription>Informacja</AlertDescription>
      </Alert>,
    );
    expect(screen.queryByRole('alert')).toBeNull();
    rerender(<Alert variant="success" role="status">Zapisano</Alert>);
    expect(screen.getByRole('status')).toHaveTextContent('Zapisano');
  });
});

describe('ui/badge', () => {
  it('success używa tekstu AA (success-text), nie białego na --success', () => {
    render(<Badge variant="success">OK</Badge>);
    const badge = screen.getByText('OK');
    expect(badge.className).toContain('text-success-text');
    expect(badge.className).not.toContain('text-white');
  });
});

describe('strażnik: ręczne tabele w aplikacji', () => {
  it('trasy i komponenty używają ui/table zamiast surowego <table>', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx$/.test(entry) && /<table[\s>]/.test(readFileSync(path, 'utf8'))) {
          offenders.push(path);
        }
      }
    };
    walk('src/app');
    walk('src/components');
    // ui/table.tsx to jedyne miejsce z <table>; e-maile (src/emails) mają własne tabele układu.
    expect(offenders.map((p) => p.replace(/\\/g, '/'))).toEqual(['src/components/ui/table.tsx']);
  });
});

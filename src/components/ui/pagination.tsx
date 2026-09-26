import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Pagination (shadcn-style API) — nawigacja stron listy.
 *
 * `<Pagination aria-label>` = landmark `<nav>` (nazwa obowiązkowa — tekst z `src/messages`),
 * `PaginationContent` = lista `<ul>`, `PaginationItem` = `<li>`. W pozycji wywołujący
 * wstawia `Link` z `@/i18n/navigation` (prefiks locale; bieżąca strona z `aria-current="page"`)
 * i jego wygląd (np. `BTN_SECONDARY`). Bez `Slot`: komponent zostaje serwerowy (zero JS,
 * brak hooków w RSC), a strona publiczna ma własne `Pagination` (budżet JS, #395).
 */
export interface PaginationProps extends React.HTMLAttributes<HTMLElement> {
  'aria-label': string;
}

const Pagination = React.forwardRef<HTMLElement, PaginationProps>(({ className, ...props }, ref) => (
  <nav ref={ref} className={cn(className)} {...props} />
));
Pagination.displayName = 'Pagination';

const PaginationContent = React.forwardRef<HTMLUListElement, React.HTMLAttributes<HTMLUListElement>>(
  ({ className, ...props }, ref) => (
    <ul ref={ref} className={cn('flex flex-wrap items-center gap-2', className)} {...props} />
  ),
);
PaginationContent.displayName = 'PaginationContent';

const PaginationItem = React.forwardRef<HTMLLIElement, React.LiHTMLAttributes<HTMLLIElement>>(
  (props, ref) => <li ref={ref} {...props} />,
);
PaginationItem.displayName = 'PaginationItem';

export { Pagination, PaginationContent, PaginationItem };

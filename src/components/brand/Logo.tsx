import * as React from 'react';
import { cn } from '@/lib/utils';

/** Znak „Ludzie i praca”: słowo pracuj i biały sufiks na czerwonym kafelku. */
export function Logo({ className }: { className?: string }): React.JSX.Element {
  return (
    <span className={cn('inline-flex items-center whitespace-nowrap text-foreground', className)} role="img" aria-label="Pracuj.be">
      <span aria-hidden="true" className="inline-flex items-baseline gap-0.5 text-2xl font-bold leading-none tracking-tighter">
        pracuj<span className="rounded-lg bg-primary px-1.5 py-1 text-primary-foreground">.be</span>
      </span>
    </span>
  );
}

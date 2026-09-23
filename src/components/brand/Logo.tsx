import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Znak „Ludzie i praca”: słowo pracuj i biały sufiks na czerwonym kafelku.
 * Kafelek jest wymiarowany w `em` (przy domyślnym text-2xl: padding 4/6 px, promień 14 px
 * = --radius), więc skaluje się z fontem logo. Nadpisanie rozmiaru przez `className`
 * (np. stały rozmiar w wąskim nagłówku) zachowuje proporcje znaku.
 */
export function Logo({ className }: { className?: string }): React.JSX.Element {
  return (
    <span className={cn('inline-flex items-center whitespace-nowrap text-2xl text-foreground', className)} role="img" aria-label="Pracuj.be">
      <span aria-hidden="true" className="inline-flex items-baseline gap-[calc(1em/12)] font-bold leading-none tracking-tighter">
        pracuj<span className="rounded-[calc(7em/12)] bg-primary px-[0.25em] py-[calc(1em/6)] text-primary-foreground">.be</span>
      </span>
    </span>
  );
}

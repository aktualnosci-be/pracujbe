import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Znak „Ludzie i praca”: słowo pracuj i biały sufiks na czerwonym kafelku.
 * Geometria dosłownie z prototypu (`.people .logo` + `.people .logo .suffix`, extended.css):
 * światło −1,5 px przy 29 px (≈ −0,052 em), kafelek z odstępem .09 em, dopełnieniem
 * .1/.17/.14 em i promieniem .22 em. Waga 800 z prototypu tylko w nagłówku publicznym
 * (`className="font-extrabold"`); w panelach zostaje 700, żeby wąski pasek przy 320 px i
 * tekście 200% się mieścił. Wszystko w `em`, więc znak skaluje się z rozmiarem
 * fontu (nadpisanie przez `className`, np. 29 px w nagłówku, zachowuje proporcje).
 */
export function Logo({ className }: { className?: string }): React.JSX.Element {
  return (
    <span className={cn('inline-flex items-center whitespace-nowrap text-2xl font-bold text-foreground', className)} role="img" aria-label="Pracuj.be">
      <span aria-hidden="true" className="inline-flex items-baseline leading-none tracking-[-0.052em]">
        pracuj<span className="ml-[0.09em] inline-block rounded-[0.22em] bg-primary px-[0.17em] pb-[0.14em] pt-[0.1em] leading-none tracking-[-0.055em] text-primary-foreground">.be</span>
      </span>
    </span>
  );
}

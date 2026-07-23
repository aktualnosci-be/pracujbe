import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Logo Pracuj.be — znak tekstowo-symboliczny.
 *
 * Symbol: kwadrat z zaokrąglonymi rogami w kolorze `primary`, w środku geometryczna
 * litera „P" (kontra wycięta regułą even-odd) oraz subtelny akcent pinu lokalizacji
 * w prawym dolnym rogu — sugeruje „praca blisko Ciebie", bez stereotypów zawodowych
 * (żadnego krawata/teczki/kasku). Obok wordmark „Pracuj.be" z akcentem „.be".
 *
 * Skalowalny (SVG inline, jednostki em/klasy Tailwind), z dostępnym aria-label.
 * Domyślnie komponent serwerowy (brak interakcji/hooków).
 */
export function Logo({ className }: { className?: string }): React.JSX.Element {
  return (
    <span
      className={cn('inline-flex items-center gap-2 text-foreground', className)}
      role="img"
      aria-label="Pracuj.be"
    >
      <svg
        viewBox="0 0 32 32"
        className="h-8 w-8 shrink-0"
        aria-hidden="true"
        focusable="false"
      >
        <rect x="0" y="0" width="32" height="32" rx="8" className="fill-primary" />
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M11 8.5 h6.2 a5.3 5.3 0 0 1 0 10.6 H14 V23.5 H11 Z M14 11.3 h2.4 a2.6 2.6 0 0 1 0 5.2 H14 Z"
          className="fill-primary-foreground"
        />
        <path
          d="M22.6 17.4 a2.5 2.5 0 0 1 2.5 2.5 c0 1.9 -2.5 4.1 -2.5 4.1 s-2.5 -2.2 -2.5 -4.1 a2.5 2.5 0 0 1 2.5 -2.5 Z"
          className="fill-primary-foreground opacity-70"
        />
      </svg>
      <span aria-hidden="true" className="text-lg font-bold leading-none tracking-tight">
        Pracuj<span className="text-primary">.be</span>
      </span>
    </span>
  );
}

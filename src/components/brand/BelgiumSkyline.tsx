import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * BelgiumSkyline — lekka, jednokolorowa line-art panorama Brukseli do sekcji hero.
 *
 * Motyw: gotycki ratusz na Grand-Place (smukła wieża/iglica) w otoczeniu domów cechowych
 * ze schodkowymi i trójkątnymi szczytami oraz masztem z flagą. Rysunek konturowy
 * (`stroke="currentColor"`, bez wypełnień tła), więc barwę ustawia rodzic klasą tekstu
 * (np. `text-accent/30`, `text-primary/10`). Element czysto dekoracyjny — `aria-hidden`.
 * Komponent serwerowy (brak interakcji).
 */
export function BelgiumSkyline({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 480 140"
      className={cn('h-auto w-full text-accent/25', className)}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      {/* linia ziemi */}
      <line x1="0" y1="130" x2="480" y2="130" />

      {/* lewe domy cechowe */}
      <path d="M14 130 V96 H46 V130" />
      <path d="M22 96 V86 H38 V96" />
      <path d="M58 130 V80 L72 66 L86 80 V130" />
      <path d="M98 130 V90 H128 V90 L128 78 H108 V90" />

      {/* centralny ratusz — wieża i iglica */}
      <path d="M206 130 V70 H274 V130" />
      <path d="M214 70 V50 H266 V70" />
      <path d="M226 50 V38 H254 V50" />
      <path d="M234 38 V26 L240 8 L246 26 V38 H234 Z" />
      <circle cx="240" cy="6" r="2.5" />

      {/* prawe domy cechowe ze schodkowymi/trójkątnymi szczytami */}
      <path d="M292 130 V84 L308 68 L324 84 V130" />
      <path d="M336 130 V88 H336 L336 76 H356 V64 H372 V76 H392 V88 V130" />
      <path d="M404 130 V82 L418 70 L432 82 V130" />

      {/* maszt z flagą */}
      <line x1="452" y1="130" x2="452" y2="34" />
      <path d="M452 40 H474 V54 H452" />
    </svg>
  );
}

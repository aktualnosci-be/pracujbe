import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Skeleton (shadcn-style) — blok zastępczy na czas odczytu danych.
 *
 * Tło `bg-soft` (token „Ludzie i praca”), pulsowanie tylko przy `motion-safe`
 * (szanuje `prefers-reduced-motion`). Element jest dekoracyjny: `aria-hidden`
 * domyślnie, stan ładowania ogłasza osobny tekst z `role="status"` u rodzica.
 * Kształt (wysokość, szerokość, promień) podaje wywołujący przez `className`.
 */
const Skeleton = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      aria-hidden="true"
      className={cn('rounded-md bg-soft motion-safe:animate-pulse', className)}
      {...props}
    />
  ),
);
Skeleton.displayName = 'Skeleton';

export { Skeleton };

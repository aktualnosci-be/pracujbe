import * as React from 'react';
import { Check, Plus } from 'lucide-react';

import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

/**
 * ProfileChecklist — lista sekcji profilu z ich stanem (makiety 04 i 06).
 *
 * Każda pozycja pokazuje etykietę (z i18n) oraz stan po prawej:
 *  - `done` → zielony „✓" (sekcja uzupełniona),
 *  - `action` + `href` (i BEZ `done`) → prawdziwy link „＋ <action>" do kroku kreatora,
 *    dostępny z klawiatury, z nazwą „<action>: <label>" (#317),
 *  - `action` bez `href` / `hint` (i BEZ `done`) → neutralny, wyszarzony tekst. Bez celu
 *    nawigacji nie udajemy linku (akcentowy kolor i plus są zarezerwowane dla linku).
 *
 * Etykiety/teksty przekazuje ekran (już przetłumaczone). Może być renderowany serwerowo
 * i klientcko.
 */

export interface ProfileChecklistItem {
  label: string;
  /** Sekcja uzupełniona → zielony znacznik. */
  done?: boolean;
  /** Etykieta akcji dodania (np. „Dodaj") — link tylko razem z `href`. */
  action?: string;
  /** Cel akcji (ścieżka bez prefiksu locale, np. `/candidate/onboarding?step=3`). */
  href?: string;
  /** Neutralny opis stanu (np. „Brak"), gdy sekcja nieuzupełniona i bez akcji. */
  hint?: string;
}

export interface ProfileChecklistProps {
  items: ProfileChecklistItem[];
  className?: string;
}

export function ProfileChecklist({ items, className }: ProfileChecklistProps): React.JSX.Element {
  return (
    <ul className={cn('space-y-3', className)}>
      {items.map((item) => (
        <li key={item.label} className="flex items-center justify-between gap-3">
          <span
            className={cn(
              'text-sm',
              item.done ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            {item.label}
          </span>

          {item.done ? (
            <span
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-success/10 text-success"
              aria-hidden="true"
            >
              <Check className="h-3.5 w-3.5" />
            </span>
          ) : item.action && item.href ? (
            <Link
              href={item.href}
              aria-label={`${item.action}: ${item.label}`}
              className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-md px-1 text-sm font-medium text-accent-dark hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              {item.action}
            </Link>
          ) : item.hint || item.action ? (
            <span className="shrink-0 text-xs font-medium text-muted-foreground">
              {item.hint ?? item.action}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

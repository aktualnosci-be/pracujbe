import * as React from 'react';
import { Check, Plus } from 'lucide-react';

import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { CHECKLIST } from '@/components/candidate/candidate-styles';

/**
 * ProfileChecklist — lista sekcji profilu z ich stanem (makiety 04 i 06).
 *
 * Wygląd: `.checklist` z prototypu „04 Ludzie i praca” (13 px, interlinia 2.5, znacznik
 * „✓” w kolorze marki, nieuzupełniona pozycja „+”). Stan po prawej:
 *  - `done` → tylko znacznik „✓" (sekcja uzupełniona; stan niesie też kolor tekstu),
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
    <ul className={cn(CHECKLIST, className)}>
      {items.map((item) => (
        <li key={item.label} className="flex min-w-0 flex-wrap items-center justify-between gap-x-3">
          <span
            className={cn(
              'flex min-w-0 items-center break-words',
              item.done ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            {/* `.checklist li:before` — „✓” w kolorze marki; nieuzupełniona pozycja „+”. */}
            <span className="mr-[9px] shrink-0 text-primary" aria-hidden="true">
              {item.done ? <Check className="size-3.5" /> : <Plus className="size-3.5" />}
            </span>
            {item.label}
          </span>

          {item.done ? null : item.action && item.href ? (
            <Link
              href={item.href}
              aria-label={`${item.action}: ${item.label}`}
              className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-md px-1 text-[13px] font-bold leading-normal text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              {item.action}
            </Link>
          ) : item.hint || item.action ? (
            <span className="shrink-0 text-xs font-medium leading-normal text-muted-foreground">
              {item.hint ?? item.action}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

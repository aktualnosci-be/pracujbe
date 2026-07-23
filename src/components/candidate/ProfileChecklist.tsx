import * as React from 'react';
import { Check, Plus } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * ProfileChecklist — lista sekcji profilu z ich stanem (makiety 04 i 06).
 *
 * Każda pozycja pokazuje etykietę (z i18n) oraz stan po prawej:
 *  - `done` → zielony „✓" (sekcja uzupełniona),
 *  - `action` (i BEZ `done`) → akcentowy odnośnik „＋ <action>" (np. „+ Dodaj" w panelu),
 *  - `hint` (i BEZ `done`) → wyszarzony tekst (np. „Brak" w kreatorze onboardingu).
 *
 * Etykiety/teksty przekazuje ekran (już przetłumaczone). Komponent prezentacyjny —
 * bez interakcji, może być renderowany serwerowo i klienckko. `action` jest tylko
 * etykietą wizualną (klik obsłuży przyszły backend — TODO(data) po stronie ekranu).
 */

export interface ProfileChecklistItem {
  label: string;
  /** Sekcja uzupełniona → zielony znacznik. */
  done?: boolean;
  /** Etykieta akcji dodania (np. „Dodaj") — akcentowa, gdy sekcja nieuzupełniona. */
  action?: string;
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
          ) : item.action ? (
            // TODO(data): nawigacja do sekcji profilu — podpiąć w etapie kandydata.
            <span className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-accent">
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              {item.action}
            </span>
          ) : item.hint ? (
            <span className="shrink-0 text-xs font-medium text-muted-foreground">{item.hint}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

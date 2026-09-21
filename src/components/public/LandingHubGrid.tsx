import * as React from 'react';
import { ArrowRight } from 'lucide-react';

import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

/**
 * LandingHubGrid — siatka kafli linkujących do landing-page'y (branże / miasta).
 *
 * Używana na hubie `/praca` (spis branż i miast) oraz do przekierowań krzyżowych.
 * Każdy kafel: opcjonalna ikona, tytuł (rozciągnięty, klikalny link), krótki opis oraz
 * opcjonalny meta-tekst (np. liczba ofert). Cały kafel jest klikalny (stretched link),
 * z pierścieniem focus na całej karcie (`focus-within`) dla dostępności klawiatury.
 *
 * Komponent serwerowy (bez stanu/hooków) — `href` jest ścieżką bez prefiksu języka,
 * który dokłada `Link` z `@/i18n/navigation`.
 */

export interface LandingHubItem {
  /** Stabilny klucz React (np. klucz kategorii/miasta). */
  key: string;
  /** Ścieżka docelowa bez prefiksu języka (np. `/praca/kategoria/construction`). */
  href: string;
  title: string;
  description: string;
  /** Opcjonalny meta-tekst pod opisem (np. liczba ofert). */
  meta?: string;
  /** Opcjonalna ikona dekoracyjna (aria-hidden po stronie wywołującego). */
  icon?: React.ReactNode;
}

export interface LandingHubGridProps {
  items: LandingHubItem[];
  /** Etykieta listy dla czytników ekranu. */
  ariaLabel?: string;
  className?: string;
}

export function LandingHubGrid({
  items,
  ariaLabel,
  className,
}: LandingHubGridProps): React.JSX.Element {
  return (
    <ul
      aria-label={ariaLabel}
      className={cn('grid gap-3 sm:grid-cols-2 lg:grid-cols-3', className)}
    >
      {items.map((item) => (
        <li key={item.key} className="min-w-0">
          <div className="group relative flex h-full flex-col rounded-lg border border-border bg-card p-4 transition-colors hover:bg-soft focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
            <div className="flex items-center gap-3">
              {item.icon ? (
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent-dark">
                  {item.icon}
                </span>
              ) : null}
              <h3 className="min-w-0 flex-1 text-base font-semibold text-foreground">
                <Link
                  href={item.href}
                  className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
                >
                  {item.title}
                </Link>
              </h3>
              <ArrowRight
                className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{item.description}</p>
            {item.meta ? (
              <p className="mt-3 text-xs font-medium text-muted-foreground">{item.meta}</p>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

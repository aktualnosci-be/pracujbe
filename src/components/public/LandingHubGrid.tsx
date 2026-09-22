import * as React from "react";
import { ArrowRight } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

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
      className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-3", className)}
    >
      {items.map((item) => (
        <li key={item.key} className="min-w-0">
          <Link
            href={item.href}
            className="group flex min-h-12 h-full min-w-0 flex-col rounded-sm border border-border border-l-4 border-l-accent bg-white p-4 text-foreground transition-colors hover:bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <div className="flex items-center gap-3">
              {item.icon ? (
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-sm bg-accent text-white [&>svg]:h-5 [&>svg]:w-5">
                  {item.icon}
                </span>
              ) : null}
              <h3 className="min-w-0 flex-1 text-lg font-bold leading-snug">
                {item.title}
              </h3>
              <ArrowRight
                className="h-5 w-5 shrink-0 text-accent transition-transform group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </div>
            <p className="mt-3 text-base leading-relaxed text-muted-foreground">
              {item.description}
            </p>
            {item.meta ? (
              <p className="mt-3 text-sm font-semibold text-accent-dark">
                {item.meta}
              </p>
            ) : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}

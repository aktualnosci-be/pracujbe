import * as React from "react";

import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/**
 * Breadcrumbs — ścieżka nawigacji stron publicznych.
 *
 * Ostatni element to bieżąca strona: bez linku, z `aria-current="page"`, żeby czytnik ekranu
 * ogłaszał ją jako bieżącą (nie tylko wyróżnienie kolorem). Linki mają obszar klikalny
 * min. 44 px wysokości (cel dotykowy na mobile) bez zmiany wyglądu tekstu. Separatory są
 * dekoracyjne (`aria-hidden`). Etykiety przekazuje wywołujący (z i18n).
 *
 * Komponent serwerowy — `href` jest ścieżką bez prefiksu języka (dokłada go `Link`).
 */

export interface BreadcrumbItem {
  label: string;
  /** Brak `href` = bieżąca strona (powinna być ostatnia). */
  href?: string;
}

export interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  /** Nazwa landmarku `nav` (np. `common.breadcrumb`). */
  ariaLabel: string;
  className?: string;
}

export function Breadcrumbs({ items, ariaLabel, className }: BreadcrumbsProps): React.JSX.Element {
  return (
    <nav aria-label={ariaLabel} className={cn("mb-2 text-sm text-muted-foreground", className)}>
      <ol className="flex flex-wrap items-center gap-x-1.5">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <React.Fragment key={`${index}-${item.label}`}>
              <li className="flex min-h-11 items-center">
                {item.href && !isLast ? (
                  <Link
                    href={item.href}
                    className="inline-flex min-h-11 items-center rounded-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    {item.label}
                  </Link>
                ) : (
                  <span aria-current="page" className="text-foreground">
                    {item.label}
                  </span>
                )}
              </li>
              {isLast ? null : <li aria-hidden="true">/</li>}
            </React.Fragment>
          );
        })}
      </ol>
    </nav>
  );
}

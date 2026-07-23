import * as React from 'react';
import {
  Boxes,
  HardHat,
  HeartHandshake,
  Leaf,
  type LucideIcon,
  Package,
  Factory,
  SprayCan,
  Truck,
  UtensilsCrossed,
  Wrench,
} from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import type { CategoryKey } from '@/lib/jobs';

/**
 * CategoryGrid — kafelki 10 popularnych branż (kategorii).
 *
 * Każdy kafelek linkuje do listy ofert z filtrem kategorii (`/oferty-pracy?category=<key>`).
 * Komponent serwerowy; etykiety z namespace `categories`, nagłówek z `home`.
 */

const JOBS_PATH = '/oferty-pracy';

const CATEGORIES: { key: CategoryKey; Icon: LucideIcon }[] = [
  { key: 'construction', Icon: HardHat },
  { key: 'transport', Icon: Truck },
  { key: 'warehouse', Icon: Package },
  { key: 'production', Icon: Factory },
  { key: 'technical', Icon: Wrench },
  { key: 'cleaning', Icon: SprayCan },
  { key: 'hospitality', Icon: UtensilsCrossed },
  { key: 'care', Icon: HeartHandshake },
  { key: 'logistics', Icon: Boxes },
  { key: 'seasonal', Icon: Leaf },
];

export async function CategoryGrid(): Promise<React.JSX.Element> {
  const t = await getTranslations('categories');
  const tHome = await getTranslations('home');

  return (
    <section className="border-t border-border bg-soft">
      <div className="container py-12 md:py-16">
        <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          {tHome('categoriesTitle')}
        </h2>
        <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {CATEGORIES.map(({ key, Icon }) => (
            <li key={key}>
              <Link
                href={{ pathname: JOBS_PATH, query: { category: key } }}
                className="flex h-full items-center gap-3 rounded-lg border border-border bg-background p-4 transition-colors hover:border-primary/40 hover:bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="text-sm font-medium text-foreground">{t(key)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

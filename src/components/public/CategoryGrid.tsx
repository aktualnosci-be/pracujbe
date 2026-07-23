import * as React from 'react';
import {
  ArrowRight,
  Boxes,
  Factory,
  HardHat,
  HeartHandshake,
  type LucideIcon,
  SprayCan,
  UtensilsCrossed,
} from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import type { CategoryKey } from '@/lib/jobs';

/**
 * CategoryGrid — blok „Popularne kategorie" wg makiety `01-home`.
 *
 * Lista 6 branż w dwóch kolumnach (wypełnianych kolumnowo, jak na makiecie): ikona + nazwa
 * + licznik ofert. Nagłówek z linkiem „Zobacz wszystkie →". Każdy wiersz linkuje do listy
 * ofert z filtrem kategorii. Komponent serwerowy; renderowany w kolumnie przez `page.tsx`.
 *
 * TODO(data): liczniki ofert są danymi demonstracyjnymi — podłączyć realne zliczanie z DB.
 */

const JOBS_PATH = '/oferty-pracy';

const CATEGORIES: { key: CategoryKey; Icon: LucideIcon; count: number }[] = [
  { key: 'production', Icon: Factory, count: 1248 },
  { key: 'logistics', Icon: Boxes, count: 982 },
  { key: 'construction', Icon: HardHat, count: 764 },
  { key: 'care', Icon: HeartHandshake, count: 612 },
  { key: 'cleaning', Icon: SprayCan, count: 540 },
  { key: 'hospitality', Icon: UtensilsCrossed, count: 428 },
];

export async function CategoryGrid(): Promise<React.JSX.Element> {
  const t = await getTranslations('categories');
  const tHome = await getTranslations('home');
  const tCommon = await getTranslations('common');

  return (
    <div>
      <div className="flex items-end justify-between gap-4">
        <h2 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
          {tHome('categoriesTitle')}
        </h2>
        <Link
          href={JOBS_PATH}
          className="inline-flex items-center gap-1 text-sm font-medium text-accent underline-offset-4 hover:underline"
        >
          {tCommon('seeAll')}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>

      <ul className="mt-4 grid grid-cols-1 gap-1 sm:grid-flow-col sm:grid-cols-2 sm:grid-rows-3">
        {CATEGORIES.map(({ key, Icon, count }) => (
          <li key={key}>
            <Link
              href={{ pathname: JOBS_PATH, query: { category: key } }}
              className="group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent">
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                {t(key)}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {tHome('offersCount', { count })}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

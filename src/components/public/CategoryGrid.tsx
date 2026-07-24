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
import { getLocale, getTranslations } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { getCategoryCounts, type CategoryKey } from '@/lib/jobs';

/**
 * CategoryGrid — blok „Popularne kategorie" wg makiety `01-home`.
 *
 * Lista 6 branż w dwóch kolumnach (wypełnianych kolumnowo, jak na makiecie): ikona + nazwa
 * + licznik ofert. Nagłówek z linkiem „Zobacz wszystkie →". Każdy wiersz linkuje do listy
 * ofert z filtrem kategorii. Komponent serwerowy; renderowany w kolumnie przez `page.tsx`.
 *
 * P1-09: liczniki są REALNE (get_public_jobs_count per kategoria). W trybie demo (bez env)
 * `getCategoryCounts` zwraca null → pomijamy badge zamiast pokazywać zmyśloną liczbę.
 */

const JOBS_PATH = '/oferty-pracy';

const CATEGORIES: { key: CategoryKey; Icon: LucideIcon }[] = [
  { key: 'production', Icon: Factory },
  { key: 'logistics', Icon: Boxes },
  { key: 'construction', Icon: HardHat },
  { key: 'care', Icon: HeartHandshake },
  { key: 'cleaning', Icon: SprayCan },
  { key: 'hospitality', Icon: UtensilsCrossed },
];

export async function CategoryGrid(): Promise<React.JSX.Element> {
  const t = await getTranslations('categories');
  const tHome = await getTranslations('home');
  const tCommon = await getTranslations('common');
  const locale = await getLocale();
  const counts = await getCategoryCounts(
    locale,
    CATEGORIES.map((c) => c.key),
  );

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
        {CATEGORIES.map(({ key, Icon }) => (
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
              {counts ? (
                <span className="shrink-0 text-xs text-muted-foreground">
                  {tHome('offersCount', { count: counts[key] ?? 0 })}
                </span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

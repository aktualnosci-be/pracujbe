import * as React from 'react';
import { ArrowRight, MapPin } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import type { LocationKey } from '@/lib/jobs';

/**
 * LocationGrid — blok „Popularne lokalizacje" wg makiety `01-home`.
 *
 * Lista 6 miast w dwóch kolumnach (wypełnianych kolumnowo, jak na makiecie): ikona pinu
 * + nazwa + licznik ofert. Nagłówek z linkiem „Zobacz wszystkie →". Wiersz linkuje do listy
 * ofert filtrowanej po mieście (wartość = nazwa miasta w bieżącym języku, zgodna z danymi
 * ofert). Komponent serwerowy; renderowany w kolumnie przez `page.tsx`.
 *
 * TODO(data): liczniki ofert są danymi demonstracyjnymi — podłączyć realne zliczanie z DB.
 */

const JOBS_PATH = '/oferty-pracy';

const LOCATIONS: { key: LocationKey; count: number }[] = [
  { key: 'antwerp', count: 1856 },
  { key: 'brussels', count: 1412 },
  { key: 'ghent', count: 1038 },
  { key: 'liege', count: 876 },
  { key: 'charleroi', count: 664 },
  { key: 'hasselt', count: 512 },
];

export async function LocationGrid(): Promise<React.JSX.Element> {
  const t = await getTranslations('locations');
  const tHome = await getTranslations('home');
  const tCommon = await getTranslations('common');

  return (
    <div>
      <div className="flex items-end justify-between gap-4">
        <h2 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
          {tHome('locationsTitle')}
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
        {LOCATIONS.map(({ key, count }) => {
          const name = t(key);
          return (
            <li key={key}>
              <Link
                href={{ pathname: JOBS_PATH, query: { city: name } }}
                className="group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent">
                  <MapPin className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                  {name}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {tHome('offersCount', { count })}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

import * as React from 'react';
import { MapPin } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import type { LocationKey } from '@/lib/jobs';

/**
 * LocationGrid — kafelki 10 popularnych miast.
 *
 * Każdy kafelek linkuje do listy ofert filtrowanej po mieście
 * (`/oferty-pracy?city=<nazwa miasta w bieżącym języku>`). Etykieta i wartość
 * filtra pochodzą z tego samego klucza `locations`, zgodnego z nazwami miast
 * w danych ofert. Komponent serwerowy.
 */

const JOBS_PATH = '/oferty-pracy';

const LOCATIONS: LocationKey[] = [
  'brussels',
  'antwerp',
  'ghent',
  'leuven',
  'mechelen',
  'hasselt',
  'liege',
  'charleroi',
  'bruges',
  'kortrijk',
];

export async function LocationGrid(): Promise<React.JSX.Element> {
  const t = await getTranslations('locations');
  const tHome = await getTranslations('home');

  return (
    <section className="container py-12 md:py-16">
      <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
        {tHome('locationsTitle')}
      </h2>
      <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {LOCATIONS.map((key) => {
          const name = t(key);
          return (
            <li key={key}>
              <Link
                href={{ pathname: JOBS_PATH, query: { city: name } }}
                className="flex h-full items-center gap-2.5 rounded-lg border border-border bg-background p-4 transition-colors hover:border-primary/40 hover:bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <MapPin className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span className="text-sm font-medium text-foreground">{name}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

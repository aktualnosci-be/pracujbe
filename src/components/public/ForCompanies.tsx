import * as React from 'react';
import { ArrowRight, Building2 } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';

/**
 * ForCompanies — sekcja skierowana do pracodawców.
 *
 * Nagłówek, opis i CTA prowadzące do publikacji oferty (namespace `home`,
 * klucze companies*). Komponent serwerowy; CTA jako Button asChild + Link.
 */

const POST_JOB_PATH = '/dla-pracodawcow';

export async function ForCompanies(): Promise<React.JSX.Element> {
  const t = await getTranslations('home');

  return (
    <section className="container py-12 md:py-16">
      <div className="flex flex-col items-start gap-6 rounded-2xl border border-border bg-primary/5 p-6 sm:p-10 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-4">
          <span className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground sm:flex">
            <Building2 className="h-6 w-6" aria-hidden="true" />
          </span>
          <div className="space-y-2">
            <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              {t('companiesTitle')}
            </h2>
            <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
              {t('companiesDesc')}
            </p>
          </div>
        </div>
        <Button asChild size="lg" className="w-full shrink-0 md:w-auto">
          <Link href={POST_JOB_PATH}>
            {t('companiesCta')}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </Button>
      </div>
    </section>
  );
}

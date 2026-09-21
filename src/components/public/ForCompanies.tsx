import * as React from 'react';
import { ArrowRight, UsersRound } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';

/**
 * ForCompanies — karta „Jesteś pracodawcą?" (wg makiety `01-home`).
 *
 * Miękka karta na granatowo-neutralnym tle: nagłówek, opis, granatowe CTA „Dodaj ofertę pracy"
 * oraz lekka ilustracja ludzi. Renderowana w prawej kolumnie obok „Jak to działa?" przez
 * `page.tsx`. Komponent serwerowy; CTA jako Button asChild + Link (zachowuje prefiks języka).
 */

const POST_JOB_PATH = '/dla-pracodawcow';

export async function ForCompanies(): Promise<React.JSX.Element> {
  const t = await getTranslations('home');

  return (
    <div className="flex h-full flex-col gap-4 rounded-2xl border border-border bg-soft p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <h2 className="text-lg font-bold tracking-tight text-foreground sm:text-xl">
            {t('companiesTitle')}
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">{t('companiesDesc')}</p>
        </div>
        <span
          className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent-dark sm:flex"
          aria-hidden="true"
        >
          <UsersRound className="h-6 w-6" />
        </span>
      </div>
      <Button asChild size="lg" className="w-full sm:w-auto sm:self-start">
        <Link href={POST_JOB_PATH}>
          {t('companiesCta')}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </Button>
    </div>
  );
}

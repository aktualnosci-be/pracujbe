import type { Metadata } from 'next';
import { BellRing } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { SavedSearchList } from '@/components/candidate/SavedSearchList';
import { Button } from '@/components/ui/button';
import { loadMySavedSearches } from '@/lib/data/saved-searches';
import { createAppDateFormatter } from '@/lib/datetime';

/**
 * Panel kandydata — Zapisane wyszukiwania i alerty o nowych ofertach (#100).
 *
 * Odczyt pod sesją (RLS: własne `saved_searches`, 0092), zapis przez RPC w
 * `SavedSearchList`. Błąd odczytu = jawny komunikat z ponowieniem. NOINDEX + guard
 * dziedziczone z `candidate/layout.tsx`. Daty ostatniego alertu w Europe/Brussels.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'dashboard' });
  return {
    title: t('navSearches'),
    robots: { index: false, follow: false },
  };
}

export default async function CandidateSavedSearchesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'savedSearches' });
  const td = await getTranslations({ locale, namespace: 'dashboard' });
  const load = await loadMySavedSearches();
  const formatDate = createAppDateFormatter(locale, { withTime: true });

  return (
    <div className="min-w-0 space-y-6">
      <header className="rounded-[1.75rem] border border-border bg-card p-5 sm:p-8">
        <h1 className="break-words text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          {td('navSearches')}
        </h1>
        <p className="mt-2 break-words text-base text-muted-foreground">{t('intro')}</p>
      </header>

      {load.status === 'error' ? (
        <section role="alert" className="space-y-4 rounded-[1.75rem] border border-border bg-card p-5 sm:p-7">
          <p className="break-words text-base text-foreground">{t('loadError')}</p>
          <Button asChild variant="outline" className="min-h-12 rounded-xl">
            <Link href="/candidate/wyszukiwania">{t('retry')}</Link>
          </Button>
        </section>
      ) : load.searches.length === 0 ? (
        <section className="space-y-4 rounded-[1.75rem] border border-border bg-card p-5 sm:p-7">
          <BellRing className="h-8 w-8 text-accent" aria-hidden="true" />
          <p className="break-words text-base text-foreground">{load.demo ? t('demo') : t('empty')}</p>
          <Button asChild className="min-h-12 whitespace-normal rounded-xl text-center">
            <Link href="/oferty-pracy">{t('browse')}</Link>
          </Button>
        </section>
      ) : (
        <SavedSearchList
          searches={load.searches.map((search) => ({
            ...search,
            lastAlertLabel: search.lastAlertAt ? formatDate(search.lastAlertAt) : null,
          }))}
        />
      )}
    </div>
  );
}

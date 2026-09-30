import type { Metadata } from 'next';
import { BellRing } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { SavedSearchList } from '@/components/candidate/SavedSearchList';
import { loadMySavedSearches } from '@/lib/data/saved-searches';
import { createAppDateFormatter } from '@/lib/datetime';
import { savedSearchFilterLabels } from '@/lib/job-filter-summary';
import { CandidatePageHeader } from '@/components/candidate/CandidatePageHeader';
import { BTN_PRIMARY, BTN_SECONDARY, P_EXTENDED, PAPER } from '@/components/dashboard/panel-styles';
import { cn } from '@/lib/utils';

/**
 * Panel kandydata — Zapisane wyszukiwania i alerty o nowych ofertach (#100).
 *
 * Odczyt pod sesją (RLS: własne `saved_searches`, 0092), zapis przez RPC w
 * `SavedSearchList`. Błąd odczytu = jawny komunikat z ponowieniem. NOINDEX + guard
 * dziedziczone z `candidate/layout.tsx`. Daty ostatniego alertu w Europe/Brussels. Każde
 * wyszukiwanie pokazuje swoje filtry w języku panelu (`savedSearchFilterLabels` — te same
 * etykiety co chipy listy ofert).
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
  const [tFilters, tCat, tContract, tLanguageNames, load] = await Promise.all([
    getTranslations({ locale, namespace: 'filters' }),
    getTranslations({ locale, namespace: 'categories' }),
    getTranslations({ locale, namespace: 'contractTypes' }),
    getTranslations({ locale, namespace: 'languageNames' }),
    loadMySavedSearches(),
  ]);
  const filterTranslators = {
    filters: tFilters,
    categories: tCat,
    contractTypes: tContract,
    languageNames: tLanguageNames,
  };
  const formatDate = createAppDateFormatter(locale, { withTime: true });

  return (
    <div className="min-w-0">
      <CandidatePageHeader eyebrow={td('candidatePlaceEyebrow')} title={td('navSearches')} intro={t('intro')} />

      {load.status === 'error' ? (
        <section role="alert" className={PAPER}>
          <p className={cn(P_EXTENDED, 'text-foreground')}>{t('loadError')}</p>
          <Link href="/candidate/wyszukiwania" className={cn(BTN_SECONDARY, 'mt-4')}>{t('retry')}</Link>
        </section>
      ) : load.searches.length === 0 ? (
        <section className={cn(PAPER, 'px-[25px] py-[45px] text-center')}>
          <BellRing className="mx-auto h-8 w-8 text-primary" aria-hidden="true" />
          <p className={cn(P_EXTENDED, 'mt-3')}>{load.demo ? t('demo') : t('empty')}</p>
          <Link href="/oferty-pracy" className={cn(BTN_PRIMARY, 'mt-5')}>{t('browse')}</Link>
        </section>
      ) : (
        <SavedSearchList
          currentLocale={locale as Locale}
          searches={load.searches.map((search) => ({
            ...search,
            lastAlertLabel: search.lastAlertAt ? formatDate(search.lastAlertAt) : null,
            // Filtry w języku widza z kanonicznego adresu (nazwa bywa zmieniona albo w innym języku).
            filterLabels: savedSearchFilterLabels(search.query, locale, filterTranslators),
          }))}
        />
      )}
    </div>
  );
}

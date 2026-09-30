import type { Metadata } from 'next';
import { NotebookPen } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { ApplicationJournal } from '@/components/candidate/ApplicationJournal';
import { CandidatePageHeader } from '@/components/candidate/CandidatePageHeader';
import { BTN_PRIMARY, BTN_SECONDARY, P_EXTENDED, PAPER } from '@/components/dashboard/panel-styles';
import { loadMyJournal } from '@/lib/data/application-journal';
import { cn } from '@/lib/utils';

/**
 * Panel kandydata — prywatny dziennik aplikacji wysłanych poza portalem (#904, 0196).
 * Odczyt pod sesją (RLS: tylko własne wpisy), zapis przez RPC w `ApplicationJournal`.
 * Działa w obu trybach portalu; NOINDEX + guard dziedziczone z `candidate/layout.tsx`.
 * Daty to dni kalendarzowe wpisane przez kandydata (bez strefy).
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'dashboard' });
  return { title: t('navJournal'), robots: { index: false, follow: false } };
}

export default async function CandidateJournalPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'applicationJournal' });
  const td = await getTranslations({ locale, namespace: 'dashboard' });
  const load = await loadMyJournal();

  // Dzień kalendarzowy bez strefy: formatujemy jako UTC, żeby nie przesunąć daty.
  const fmt = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' });
  const formatDay = (ymd: string | null) => (ymd ? fmt.format(new Date(`${ymd}T00:00:00Z`)) : null);

  return (
    <div className="min-w-0">
      <CandidatePageHeader eyebrow={td('candidatePlaceEyebrow')} title={t('title')} intro={t('intro')} />
      <p className={cn(P_EXTENDED, 'mb-3 max-w-2xl')}>{t('privacy')}</p>

      {load.status === 'error' ? (
        <section role="alert" className={PAPER}>
          <p className={cn(P_EXTENDED, 'text-foreground')}>{t('loadError')}</p>
          <Link href="/candidate/dziennik" className={cn(BTN_SECONDARY, 'mt-4')}>{t('retry')}</Link>
        </section>
      ) : (
        <>
          <ApplicationJournal
            demo={load.demo}
            entries={load.entries.map((entry) => ({
              ...entry,
              appliedLabel: formatDay(entry.appliedOn),
              remindLabel: formatDay(entry.remindOn),
            }))}
          />
          {load.entries.length === 0 ? (
            <section className={cn(PAPER, 'px-[25px] py-[45px] text-center')}>
              <NotebookPen className="mx-auto h-8 w-8 text-primary" aria-hidden="true" />
              <p className={cn(P_EXTENDED, 'mt-3')}>{t('empty')}</p>
              <Link href="/oferty-pracy" className={cn(BTN_PRIMARY, 'mt-5')}>{t('browse')}</Link>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

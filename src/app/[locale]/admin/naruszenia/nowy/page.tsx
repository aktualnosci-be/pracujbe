import type { Metadata } from 'next';
import { ArrowLeft } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { emptyBreachForm } from '@/lib/admin/breach';
import { AdminPageHeader } from '@/components/admin/AdminListControls';
import { BreachIncidentForm } from '@/components/admin/BreachIncidentForm';
import { TEXT_LINK } from '@/components/admin/admin-styles';

/**
 * Panel administratora — nowy wpis rejestru naruszeń (#490). Czas stwierdzenia wpisuje admin
 * (od niego liczy się 72 h); po zapisie przejście do szczegółu wpisu.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'admin' });
  return { title: t('breachNewTitle'), robots: { index: false, follow: false } };
}

export default async function AdminBreachNewPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'admin' });
  return (
    <div className="min-w-0 space-y-[22px]">
      <Link href="/admin/naruszenia" className={TEXT_LINK}>
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t('breachBack')}
      </Link>
      <AdminPageHeader eyebrow={t('breachEyebrow')} title={t('breachNewTitle')} subtitle={t('breachNewSubtitle')} />
      <BreachIncidentForm mode="create" initial={emptyBreachForm()} />
    </div>
  );
}

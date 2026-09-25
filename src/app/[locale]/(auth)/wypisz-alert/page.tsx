import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AlertOffPageContent, type AlertOffPageLabels } from '@/components/email/AlertOffPageContent';

/**
 * Wyłączenie jednego alertu zapisanego wyszukiwania z e-maila `jobMatch` (#100).
 * Strona nie otrzymuje tokenu w HTML (link niesie go we fragmencie URL); zapis dopiero po
 * kliknięciu przycisku. Noindex, bez referera.
 */
export const dynamic = 'force-dynamic';

type PageProps = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'savedSearchAlertOff' });
  return {
    title: t('metaTitle'),
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
  };
}

export default async function SavedSearchAlertOffPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'savedSearchAlertOff' });
  const labels: AlertOffPageLabels = {
    title: t('title'),
    confirmText: t('confirmText'),
    confirmButton: t('confirmButton'),
    pending: t('pending'),
    doneTitle: t('doneTitle'),
    doneText: t('doneText'),
    settingsHint: t('settingsHint'),
    loginLink: t('loginLink'),
    invalidTitle: t('invalidTitle'),
    invalidText: t('invalidText'),
    expiredTitle: t('expiredTitle'),
    expiredText: t('expiredText'),
    unavailableText: t('unavailableText'),
    errorText: t('errorText'),
  };
  return (
    <div className="py-6">
      <AlertOffPageContent labels={labels} />
    </div>
  );
}

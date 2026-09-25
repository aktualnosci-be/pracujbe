import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { NotificationsScreen } from '@/components/dashboard/NotificationsScreen';
import { parseUnreadFilter } from '@/lib/data/notifications';

/**
 * Panel kandydata — pełna lista powiadomień (#148): stronicowanie kursorem, filtr
 * „nieprzeczytane” (`?nieprzeczytane=1`), oznaczanie pojedynczo i wszystkich. NOINDEX + guard
 * z layoutu panelu.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'notifications' });
  return {
    title: t('title'),
    robots: { index: false, follow: false },
  };
}

export default async function CandidateNotificationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const unreadOnly = parseUnreadFilter((await searchParams)['nieprzeczytane']);
  return <NotificationsScreen locale={locale} role="candidate" unreadOnly={unreadOnly} />;
}

import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import type { Locale } from '@/i18n/routing';
import { MessagesView } from '@/components/messaging/MessagesView';

/**
 * Panel pracodawcy — Wiadomości (Etap 6).
 *
 * NOINDEX (panel) + `force-dynamic` (zależne od sesji/RLS). Guard dziedziczony z
 * `employer/layout.tsx`. Cała logika (lista + wątek + oznaczanie przeczytane + kompozytor)
 * w `MessagesView`; tu tylko locale, `basePath` i parametr `?c`.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'messages' });
  return {
    title: t('title'),
    robots: { index: false, follow: false },
  };
}

export default async function EmployerMessagesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ c?: string }>;
}) {
  const { locale } = await params;
  const { c } = await searchParams;
  setRequestLocale(locale);

  return (
    <MessagesView locale={locale as Locale} basePath="/employer/wiadomosci" activeParam={c} />
  );
}

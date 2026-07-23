import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { JobWizard } from '@/components/employer/JobWizard';

/**
 * Kreator oferty pracy — nowa oferta (Etap 5, makieta panelu pracodawcy).
 *
 * Cienki wrapper serwerowy: ustawia locale, metadane (NOINDEX — panel/kreator) i renderuje
 * kliencki `JobWizard`. Guard sesji + aktywnego członkostwa w firmie dziedziczony jest z
 * layoutu `employer/*` (redirect do logowania / rejestracji firmy). `force-dynamic`, bo
 * kreator działa pod sesją i zapisuje szkic przez Server Actions.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'jobWizard' });
  return {
    title: t('title'),
    robots: { index: false, follow: false },
  };
}

export default async function NewJobPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <JobWizard />;
}

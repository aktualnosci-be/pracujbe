import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { CandidatePageHeader } from '@/components/candidate/CandidatePageHeader';
import { CvImportPanel } from '@/components/candidate/CvImportPanel';
import { isCvImportEnabled } from '@/lib/cv-import/config';

/**
 * Panel kandydata — import CV przez AI (#487, #498). Za flagą `AI_CV_IMPORT_ENABLED`
 * (domyślnie wyłączona): bez niej strona nie istnieje (404), a profil wypełnia się ręcznie
 * w kreatorze. NOINDEX + guard sesji dziedziczone z `candidate/layout.tsx`.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'cvImport' });
  return { title: t('title'), robots: { index: false, follow: false } };
}

export default async function CandidateCvImportPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (!isCvImportEnabled()) notFound();
  const t = await getTranslations({ locale, namespace: 'cvImport' });
  return (
    <div className="min-w-0 max-w-3xl">
      <CandidatePageHeader eyebrow={t('eyebrow')} title={t('title')} intro={t('intro')} />
      <CvImportPanel />
    </div>
  );
}

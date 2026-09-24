import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { ReportCaseLookup } from '@/components/public/ReportCaseLookup';

/**
 * Status sprawy zgłoszenia (#41) — numer sprawy + kod dostępu (także z linku w e-mailu,
 * przez fragment `#` adresu). Bez konta. `noindex`, poza sitemap.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'contentReport' });
  return { title: t('lookupMetaTitle'), robots: { index: false, follow: false } };
}

export default async function ReportCasePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'contentReport' });

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-bold text-foreground sm:text-3xl">{t('lookupTitle')}</h1>
      <p className="mt-3 text-muted-foreground">{t('lookupIntro')}</p>
      <div className="mt-8">
        <ReportCaseLookup />
      </div>
    </div>
  );
}

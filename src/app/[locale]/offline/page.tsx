import type { Metadata } from 'next';
import { WifiOff } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

/**
 * Strona offline (fallback PWA).
 *
 * Prosta, samowystarczalna strona pokazywana przy braku połączenia. Celowo minimalna
 * i odporna: używa wyłącznie istniejących kluczy i18n z namespace 'common'
 * (appName, error, retry) oraz ikony do zasygnalizowania braku sieci — bez literałów
 * tekstu UI i bez zależności od komponentów innych agentów. "Spróbuj ponownie" prowadzi
 * do strony głównej w bieżącym języku (zadziała po przywróceniu połączenia).
 */

type OfflinePageProps = {
  params: Promise<{ locale: string }>;
};

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function OfflinePage({ params }: OfflinePageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('common');

  return (
    <main className="flex min-h-[70vh] flex-col items-center justify-center gap-6 px-4 py-16 text-center">
      <span
        className="flex h-16 w-16 items-center justify-center rounded-full bg-soft text-muted-foreground"
        aria-hidden="true"
      >
        <WifiOff className="h-8 w-8" />
      </span>
      <div className="space-y-2">
        <p className="text-sm font-semibold uppercase tracking-wide text-primary">{t('appName')}</p>
        <h1 className="text-2xl font-semibold text-foreground">{t('error')}</h1>
      </div>
      <Link
        href="/"
        className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-dark"
      >
        {t('retry')}
      </Link>
    </main>
  );
}

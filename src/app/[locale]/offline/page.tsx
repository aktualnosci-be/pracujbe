import type { Metadata } from 'next';
import { WifiOff } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Logo } from '@/components/brand/Logo';
import { Link } from '@/i18n/navigation';

/**
 * Strona offline (fallback PWA).
 *
 * Prosta, samowystarczalna strona o braku połączenia. Tytuł karty, nagłówek i treść
 * pochodzą z przestrzeni `offline` (#248). Jedyna akcja prowadzi na stronę główną
 * w bieżącym języku i tak też jest nazwana — nie udaje „ponowienia” bieżącego adresu.
 */

type OfflinePageProps = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: OfflinePageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'offline' });
  return {
    title: t('title'),
    robots: { index: false, follow: false },
  };
}

export default async function OfflinePage({ params }: OfflinePageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('offline');

  return (
    <main className="flex min-h-[70vh] flex-col items-center justify-center gap-6 px-4 py-16 text-center">
      <span
        className="flex h-16 w-16 items-center justify-center rounded-full bg-soft text-muted-foreground"
        aria-hidden="true"
      >
        <WifiOff className="h-8 w-8" />
      </span>
      <div className="max-w-md space-y-3">
        <Logo />
        <h1 className="text-2xl font-semibold text-foreground">{t('heading')}</h1>
        <p className="text-base leading-relaxed text-muted-foreground">{t('body')}</p>
      </div>
      <Link
        href="/"
        className="inline-flex min-h-12 items-center justify-center rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {t('goHome')}
      </Link>
    </main>
  );
}

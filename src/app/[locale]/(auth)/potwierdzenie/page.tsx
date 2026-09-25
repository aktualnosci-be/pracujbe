import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { MailCheck } from 'lucide-react';

import { Link } from '@/i18n/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Potwierdzenie e-maila — strona informacyjna po rejestracji ("sprawdź skrzynkę"). Sam link
 * z wiadomości prowadzi do `/potwierdz-email#token=…`, gdzie adres potwierdza przycisk
 * (server action `confirmEmail`). Strona nie tworzy sesji. Wyłączona z indeksowania (noindex).
 */

type PageProps = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'auth' });
  return {
    title: t('verifyTitle'),
    description: t('verifySubtitle'),
    robots: { index: false, follow: false },
  };
}

export default async function ConfirmationPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('auth');

  return (
    <div className="container flex min-h-[calc(100vh-8rem)] items-center justify-center py-12">
      <div className="w-full max-w-md">
        <Card>
          <CardHeader className="items-center space-y-3 text-center">
            <span
              className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary"
              aria-hidden="true"
            >
              <MailCheck className="h-7 w-7" />
            </span>
            <CardTitle as="h1" className="text-2xl">{t('verifyTitle')}</CardTitle>
            <CardDescription>{t('verifySubtitle')}</CardDescription>
          </CardHeader>
          <CardContent className="text-center text-sm">
            <Link
              href="/logowanie"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              {t('backToLogin')}
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { MailCheck } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmEmailForm } from './ConfirmEmailForm';

/**
 * Potwierdzenie adresu z linku e-mail (`/{locale}/potwierdz-email#token=…`, język odbiorcy, #24).
 * Token jest we fragmencie (nie trafia do serwera ani logów, #505); formularz kliencki przekazuje
 * go do server action `confirmEmail` dopiero po kliknięciu przycisku — samo otwarcie linku (np.
 * przez skaner poczty) niczego nie aktywuje. Strona wyłączona z indeksowania (noindex).
 */

type PageProps = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'auth' });
  return {
    title: t('confirmEmailTitle'),
    description: t('confirmEmailIntro'),
    robots: { index: false, follow: false },
  };
}

export default async function ConfirmEmailPage({ params }: PageProps) {
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
            <CardTitle as="h1" className="text-2xl">{t('confirmEmailTitle')}</CardTitle>
            <CardDescription>{t('confirmEmailIntro')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <ConfirmEmailForm />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

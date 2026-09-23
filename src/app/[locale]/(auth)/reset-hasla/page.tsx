import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AuthForm } from '@/components/auth/AuthForm';

/**
 * Reset hasła. Formularz kliencki (AuthForm) wywołuje server action `requestPasswordReset`,
 * które ZAWSZE zwraca neutralny komunikat — nie ujawnia, czy dany e-mail istnieje.
 * Strona wyłączona z indeksowania (noindex).
 */

type PageProps = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'auth' });
  return {
    title: t('resetTitle'),
    description: t('resetSubtitle'),
    robots: { index: false, follow: false },
  };
}

export default async function ResetPasswordPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('auth');

  return (
    <div className="container flex min-h-[calc(100vh-8rem)] items-center justify-center py-12">
      <div className="w-full max-w-md">
        <Card>
          <CardHeader className="space-y-2 text-center">
            <CardTitle as="h1" className="text-2xl">{t('resetTitle')}</CardTitle>
            <CardDescription>{t('resetSubtitle')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <AuthForm variant="reset" />

            <div className="text-center text-sm">
              <Link
                href="/logowanie"
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                {t('backToLogin')}
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

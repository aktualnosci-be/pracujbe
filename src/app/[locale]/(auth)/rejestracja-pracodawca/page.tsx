import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AuthForm } from '@/components/auth/AuthForm';

/**
 * Rejestracja pracodawcy. Formularz kliencki (AuthForm) wywołuje server action
 * `registerEmployer` (rola = employer, nazwa firmy w metadanych do dalszego onboardingu),
 * zapisuje `preferred_locale` = bieżące locale i przekierowuje do potwierdzenia e-maila.
 */

type PageProps = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'auth' });
  return {
    title: t('registerEmployerTitle'),
    description: t('agreeTerms'),
  };
}

export default async function RegisterEmployerPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('auth');

  return (
    <div className="container flex min-h-[calc(100vh-8rem)] items-center justify-center py-12">
      <div className="w-full max-w-md">
        <Card>
          <CardHeader className="space-y-2 text-center">
            <CardTitle as="h1" className="text-2xl">{t('registerEmployerTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <AuthForm variant="registerEmployer" />

            <div className="space-y-3 text-center text-sm">
              <Link
                href="/rejestracja"
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                {t('registerAsCandidate')}
              </Link>
              <p className="text-muted-foreground">
                {t('haveAccount')}{' '}
                <Link
                  href="/logowanie"
                  className="font-medium text-primary underline-offset-4 hover:underline"
                >
                  {t('submitLogin')}
                </Link>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

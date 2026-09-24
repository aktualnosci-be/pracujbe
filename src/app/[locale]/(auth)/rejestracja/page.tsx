import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AuthForm } from '@/components/auth/AuthForm';
import { safeNextPath } from '@/lib/auth/next-path';

/**
 * Rejestracja kandydata (wybór roli). Formularz kliencki (AuthForm) wywołuje server action
 * `registerCandidate`, które zapisuje `preferred_locale` = bieżące locale i po sukcesie
 * przekierowuje do strony potwierdzenia e-maila. Link kieruje pracodawców do ich rejestracji.
 */

type PageProps = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'auth' });
  return {
    title: t('registerCandidateTitle'),
    description: t('agreeTerms'),
  };
}

export default async function RegisterCandidatePage({ params, searchParams }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Bezpieczny cel po potwierdzeniu e-maila (np. oferta); przenosimy go też do logowania.
  const next = safeNextPath((await searchParams)['next']);

  const t = await getTranslations('auth');

  return (
    <div className="container flex min-h-[calc(100vh-8rem)] items-center justify-center py-12">
      <div className="w-full max-w-md">
        <Card>
          <CardHeader className="space-y-2 text-center">
            <CardTitle as="h1" className="text-2xl">{t('registerCandidateTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <AuthForm variant="registerCandidate" next={next} />

            <div className="space-y-3 text-center text-sm">
              <Link
                href="/rejestracja-pracodawca"
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                {t('registerAsEmployer')}
              </Link>
              <p className="text-muted-foreground">
                {t('haveAccount')}{' '}
                <Link
                  href={next ? { pathname: '/logowanie', query: { next } } : '/logowanie'}
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

import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import {
  AuthPage,
  AuthPageHeader,
  AuthPageIntro,
  AuthPageTitle,
  AuthPaper,
} from '@/components/auth/auth-page';
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
    <AuthPage>
      <AuthPageHeader>
        <AuthPageTitle>{t('resetTitle')}</AuthPageTitle>
        <AuthPageIntro>{t('resetSubtitle')}</AuthPageIntro>
      </AuthPageHeader>
      <AuthPaper>
        <AuthForm variant="reset" />

        <div className="text-center text-sm">
          <Link
            href="/logowanie"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {t('backToLogin')}
          </Link>
        </div>
      </AuthPaper>
    </AuthPage>
  );
}

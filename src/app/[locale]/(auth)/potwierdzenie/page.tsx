import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { MailCheck } from 'lucide-react';

import { Link } from '@/i18n/navigation';
import {
  AuthPage,
  AuthPageHeader,
  AuthPageIcon,
  AuthPageIntro,
  AuthPageTitle,
  AuthPaper,
} from '@/components/auth/auth-page';

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
    <AuthPage>
      <AuthPageHeader>
        <AuthPageIcon>
          <MailCheck />
        </AuthPageIcon>
        <AuthPageTitle>{t('verifyTitle')}</AuthPageTitle>
        <AuthPageIntro>{t('verifySubtitle')}</AuthPageIntro>
      </AuthPageHeader>
      <AuthPaper className="text-sm">
        <Link
          href="/logowanie"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          {t('backToLogin')}
        </Link>
      </AuthPaper>
    </AuthPage>
  );
}

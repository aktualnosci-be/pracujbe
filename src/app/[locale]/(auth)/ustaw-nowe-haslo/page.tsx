import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import {
  AuthPage,
  AuthPageHeader,
  AuthPageIntro,
  AuthPageTitle,
  AuthPaper,
} from '@/components/auth/auth-page';
import { NewPasswordForm } from './NewPasswordForm';

/**
 * Ustawienie nowego hasła z linku resetu (`/{locale}/ustaw-nowe-haslo#token=…`, język odbiorcy).
 * Token jest we fragmencie — strona serwerowa go nie widzi; czyta go formularz kliencki
 * (NewPasswordForm) i przekazuje do server action `updatePassword`. Strona wyłączona z indeksowania.
 */

type PageProps = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'auth' });
  return {
    title: t('newPasswordTitle'),
    description: t('passwordHint'),
    robots: { index: false, follow: false },
  };
}

export default async function SetNewPasswordPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('auth');

  return (
    <AuthPage>
      <AuthPageHeader>
        <AuthPageTitle>{t('newPasswordTitle')}</AuthPageTitle>
        <AuthPageIntro>{t('passwordHint')}</AuthPageIntro>
      </AuthPageHeader>
      <AuthPaper>
        <NewPasswordForm />
      </AuthPaper>
    </AuthPage>
  );
}

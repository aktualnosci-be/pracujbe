import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { MailCheck } from 'lucide-react';

import {
  AuthPage,
  AuthPageHeader,
  AuthPageIcon,
  AuthPageIntro,
  AuthPageTitle,
  AuthPaper,
} from '@/components/auth/auth-page';
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
    <AuthPage>
      <AuthPageHeader>
        <AuthPageIcon>
          <MailCheck />
        </AuthPageIcon>
        <AuthPageTitle>{t('confirmEmailTitle')}</AuthPageTitle>
        <AuthPageIntro>{t('confirmEmailIntro')}</AuthPageIntro>
      </AuthPageHeader>
      <AuthPaper>
        <ConfirmEmailForm />
      </AuthPaper>
    </AuthPage>
  );
}

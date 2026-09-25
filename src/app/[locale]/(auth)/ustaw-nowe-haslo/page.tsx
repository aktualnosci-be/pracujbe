import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
    <div className="container flex min-h-[calc(100vh-8rem)] items-center justify-center py-12">
      <div className="w-full max-w-md">
        <Card>
          <CardHeader className="space-y-2 text-center">
            <CardTitle as="h1" className="text-2xl">{t('newPasswordTitle')}</CardTitle>
            <CardDescription>{t('passwordHint')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <NewPasswordForm />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

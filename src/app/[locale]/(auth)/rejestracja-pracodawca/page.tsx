import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link, redirect } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { getPortalIdentity, isPortalDataConfigured } from '@/lib/db/portal';
import {
  AuthPage,
  AuthPageHeader,
  AuthPageTitle,
  AuthPaper,
} from '@/components/auth/auth-page';
import { EmployerSignupEntry } from '@/components/auth/EmployerSignupEntry';

/**
 * Rejestracja pracodawcy. Formularz kliencki (AuthForm) wywołuje server action
 * `registerEmployer` (rola = employer, nazwa firmy w metadanych do dalszego onboardingu),
 * zapisuje `preferred_locale` = bieżące locale i przekierowuje do potwierdzenia e-maila.
 *
 * Link z zaproszenia do zespołu (0124, `#token=` we fragmencie) przełącza formularz na
 * rejestrację bez nazwy firmy (`EmployerSignupEntry`); zaproszenie czeka potem w panelu.
 *
 * Zalogowany pracodawca nie widzi formularza nowego konta (#365): trafia do panelu, który
 * sam pokaże zakładanie firmy, jeśli jeszcze jej nie ma.
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

  if (isPortalDataConfigured()) {
    // Rola z profilu w bazie (sesja zweryfikowana na serwerze, `readPortalIdentity`).
    // Awaria odczytu sesji nie blokuje formularza rejestracji (jak wcześniej brak użytkownika).
    const me = await getPortalIdentity().catch(() => null);
    if (me?.role === 'employer') {
      redirect({ href: '/employer', locale: locale as Locale });
    }
  }

  const t = await getTranslations('auth');

  return (
    <AuthPage>
      <AuthPageHeader>
        <AuthPageTitle>{t('registerEmployerTitle')}</AuthPageTitle>
      </AuthPageHeader>
      <AuthPaper>
        <EmployerSignupEntry />

        <div className="space-y-3 text-sm">
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
      </AuthPaper>
    </AuthPage>
  );
}

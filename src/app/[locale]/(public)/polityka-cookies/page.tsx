import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';

import { CookieSettingsButton } from '@/components/cookies/CookieSettingsButton';
import { buttonVariants } from '@/components/ui/button';

import { buildLegalMetadata, LegalPage } from '../_legal/legal-page';

/**
 * Polityka cookie (cookiePolicy) — publiczna, indeksowalna strona informacyjna.
 * Linkowana z banera zgód i centrum ustawień cookies. Treść placeholderowa z i18n (`legal.*`).
 * Niezależnie od treści strona daje przycisk otwierający centrum ustawień zgód, aby
 * użytkownik, który trafił tu z banera, mógł od razu zmienić wybór.
 */

const PATH = '/polityka-cookies';

type PageProps = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  return buildLegalMetadata({ locale, path: PATH, titleKey: 'cookiePolicyTitle' });
}

export default async function CookiePolicyPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <LegalPage
      locale={locale}
      titleKey="cookiePolicyTitle"
      actions={
        <CookieSettingsButton
          className={buttonVariants({
            variant: 'outline',
            className: 'h-auto min-h-12 whitespace-normal text-center hover:no-underline',
          })}
        />
      }
    />
  );
}

import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';

import { buildLegalMetadata, LegalPage } from '../_legal/legal-page';

/**
 * Polityka prywatności (privacy) — publiczna, indeksowalna strona informacyjna.
 * Treść placeholderowa z i18n (`legal.*`); zapisy prawne uzupełnia człowiek.
 */

const PATH = '/polityka-prywatnosci';

type PageProps = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  return buildLegalMetadata({ locale, path: PATH, titleKey: 'privacyTitle' });
}

export default async function PrivacyPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <LegalPage locale={locale} titleKey="privacyTitle" />;
}

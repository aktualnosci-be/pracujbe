import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';

import { buildLegalMetadata, LegalPage } from '../_legal/legal-page';

/**
 * Kontakt (contact) — publiczna, indeksowalna strona informacyjna.
 * Treść placeholderowa z i18n (`legal.*`).
 */

const PATH = '/kontakt';

type PageProps = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  return buildLegalMetadata({ locale, path: PATH, titleKey: 'contactTitle' });
}

export default async function ContactPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <LegalPage locale={locale} titleKey="contactTitle" />;
}

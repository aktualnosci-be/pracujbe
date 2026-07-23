import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';

import { buildLegalMetadata, LegalPage } from '../_legal/legal-page';

/**
 * FAQ (pytania i odpowiedzi) — publiczna, indeksowalna strona informacyjna.
 * Treść placeholderowa z i18n (`legal.*`).
 */

const PATH = '/faq';

type PageProps = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  return buildLegalMetadata({ locale, path: PATH, titleKey: 'faqTitle' });
}

export default async function FaqPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <LegalPage locale={locale} titleKey="faqTitle" />;
}

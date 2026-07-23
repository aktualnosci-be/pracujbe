import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';

import { buildLegalMetadata, LegalPage } from '../_legal/legal-page';

/**
 * O nas (about) — publiczna, indeksowalna strona informacyjna.
 * Treść placeholderowa z i18n (`legal.*`).
 */

const PATH = '/o-nas';

type PageProps = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  return buildLegalMetadata({ locale, path: PATH, titleKey: 'aboutTitle' });
}

export default async function AboutPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <LegalPage locale={locale} titleKey="aboutTitle" />;
}

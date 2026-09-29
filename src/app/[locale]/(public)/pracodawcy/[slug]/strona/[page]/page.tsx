import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';

import { parseCompanyJobsPageSegment } from '@/lib/companies';
import { CompanyProfileView, companyProfileMetadata } from '../../../_profile/company-profile';

/**
 * Kolejne strony ofert profilu firmy `/pracodawcy/<slug>/strona/<n>` (#638, ISR, indeksowalne).
 *
 * Profil pokazywał tylko pierwsze 50 ofert bez informacji o obcięciu. Numer strony jest
 * segmentem ścieżki, nie parametrem `?page=` — strona nie czyta `searchParams`, więc zostaje
 * statyczna/ISR jak strona 1 (#298). Tylko kanoniczny zapis `n ≥ 2`; `strona/1` (duplikat
 * adresu bazowego), `strona/01`, `strona/x` i strona za ostatnią = 404.
 */

type PageProps = {
  params: Promise<{ locale: string; slug: string; page: string }>;
};

export const revalidate = 60;

export function generateStaticParams(): Array<{ locale: string; slug: string; page: string }> {
  return [];
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, slug, page: raw } = await params;
  const page = parseCompanyJobsPageSegment(raw);
  if (page === null) return { robots: { index: false, follow: false } };
  return companyProfileMetadata(locale, slug, page);
}

export default async function CompanyProfileJobsPage({ params }: PageProps) {
  const { locale, slug, page: raw } = await params;
  setRequestLocale(locale);
  const page = parseCompanyJobsPageSegment(raw);
  if (page === null) notFound();
  return <CompanyProfileView locale={locale} slug={slug} page={page} />;
}

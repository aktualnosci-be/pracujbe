import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';

import { CompanyProfileView, companyProfileMetadata } from '../_profile/company-profile';

/**
 * Profil publiczny firmy `/pracodawcy/<slug>` (#591, SSR/ISR, INDEKSOWALNY).
 *
 * Zastępuje dawne CTA „Dowiedz się więcej o firmie” na szczególe oferty, które prowadziło do
 * wyszukiwarki po nazwie firmy (`?keyword=<nazwa>` — dopasowanie tekstowe mogło zwrócić oferty
 * innej firmy albo nic). Adres jest stabilny: `companies.slug` jest ustawiany raz przy
 * zakładaniu firmy i NIE zmienia się przy zmianie wyświetlanej nazwy.
 *
 * Tylko zweryfikowana, nieusunięta firma ma profil — inna albo zły slug = 404 (Invariant #8,
 * `getCompanyProfile` nie ujawnia technikaliów). CTA na szczególe oferty (`job.companySlug`)
 * jest ukryte, gdy profil nie istnieje, zamiast linkować donikąd (patrz issue #591).
 *
 * To strona 1 ofert firmy; kolejne pod `/pracodawcy/<slug>/strona/<n>` (#638).
 */

type PageProps = {
  params: Promise<{ locale: string; slug: string }>;
};

/** ISR (#298): profil powstaje przy pierwszym żądaniu (build nie czyta bazy) i odświeża się co 60 s. */
export const revalidate = 60;

export function generateStaticParams(): Array<{ locale: string; slug: string }> {
  return [];
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, slug } = await params;
  return companyProfileMetadata(locale, slug, 1);
}

export default async function CompanyProfilePage({ params }: PageProps) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  return <CompanyProfileView locale={locale} slug={slug} page={1} />;
}

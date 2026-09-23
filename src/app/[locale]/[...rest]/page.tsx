import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';

/**
 * Catch-all dla nieznanych ścieżek w segmencie językowym.
 *
 * Bez tej trasy adres, który nie pasuje do żadnej strony (np. `/pl/nie-istnieje`), trafia do
 * domyślnej, angielskiej strony 404 Next — bez `lang`, nawigacji i tłumaczeń. `notFound()`
 * kieruje go do zlokalizowanego `[locale]/not-found.tsx` (renderowanego w `[locale]/layout`).
 */
export default async function CatchAllNotFound({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<never> {
  const { locale } = await params;
  setRequestLocale(locale);
  notFound();
}

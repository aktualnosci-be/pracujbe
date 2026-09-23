import { permanentRedirect } from 'next/navigation';

/**
 * Goły segment bez sluga nie ma własnej treści — prowadzi do huba `/praca`
 * (spis branż i miast) zamiast zwracać 404.
 */

type PageProps = {
  params: Promise<{ locale: string }>;
};

export default async function Page({ params }: PageProps) {
  const { locale } = await params;
  permanentRedirect(`/${locale}/praca`);
}

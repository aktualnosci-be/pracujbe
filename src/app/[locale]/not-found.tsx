import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { buttonVariants } from '@/components/ui/button';

/**
 * Strona 404 dla segmentu językowego.
 * Wywoływana przez notFound() w obrębie [locale]. Renderowana wewnątrz [locale]/layout,
 * więc dziedziczy Header/Footer i kontekst i18n. Teksty z i18n (errors.notFound + common.back).
 * Kod "404" jest neutralny językowo (liczba), więc nie wymaga tłumaczenia.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function NotFound() {
  const [tErrors, tCommon] = await Promise.all([
    getTranslations('errors'),
    getTranslations('common'),
  ]);

  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-6 px-4 py-16 text-center">
      <p className="text-6xl font-bold tracking-tight text-primary" aria-hidden="true">
        404
      </p>
      <h1 className="max-w-md text-balance text-2xl font-semibold text-foreground">
        {tErrors('notFound')}
      </h1>
      <Link href="/" className={buttonVariants({ size: 'lg' })}>
        {tCommon('back')}
      </Link>
    </main>
  );
}

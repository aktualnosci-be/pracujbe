'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { useErrorRetry } from '@/components/errors/use-error-retry';
import { buttonVariants } from '@/components/ui/button';
import { captureError } from '@/lib/error-report';

/**
 * Granica błędu dla segmentu językowego (App Router). Łapie błędy renderowania stron
 * w obrębie [locale] i pokazuje PRZYJAZNY komunikat z i18n — NIGDY stack trace/technikaliów
 * (Invariant #8). Szczegóły trafiają do kanału błędów (captureError). Renderowana wewnątrz
 * [locale]/layout, więc ma kontekst i18n i chrome.
 */
export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.JSX.Element {
  const t = useTranslations('errors');
  const tc = useTranslations('common');
  const { retry } = useErrorRetry(reset);

  useEffect(() => {
    captureError(error, { area: 'app.error-boundary', digest: error.digest });
  }, [error]);

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="flex min-h-[60vh] flex-col items-center justify-center gap-6 px-4 py-16 text-center outline-none"
    >
      <h1 className="max-w-md text-balance text-2xl font-semibold text-foreground">
        {t('internal')}
      </h1>
      <p className="max-w-md text-muted-foreground">{t('generic')}</p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button type="button" onClick={retry} className={buttonVariants({ size: 'lg' })}>
          {tc('retry')}
        </button>
        <Link href="/" className={buttonVariants({ size: 'lg', variant: 'outline' })}>
          {tc('home')}
        </Link>
      </div>
    </main>
  );
}

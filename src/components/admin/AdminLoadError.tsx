import * as React from 'react';
import { useTranslations } from 'next-intl';

/**
 * AdminLoadError — jawny stan błędu odczytu w panelu admina (#311).
 *
 * Nieudany odczyt service-rolem NIE może wyglądać jak pusta lista („Brak zgłoszeń”) ani jak
 * zera w statystykach — admin mógłby przeoczyć zgłoszenia do moderacji. `role="alert"` ogłasza
 * błąd czytnikom ekranu; link ponowienia to zwykły `<a>` (pełne przeładowanie trasy
 * `force-dynamic`). Teksty z i18n (namespace `admin`), kolory tokenami.
 */
export interface AdminLoadErrorProps {
  /** Pełna ścieżka z prefiksem locale, np. `/pl/admin/firmy?status=pending`. */
  retryHref: string;
}

export function AdminLoadError({ retryHref }: AdminLoadErrorProps): React.JSX.Element {
  const t = useTranslations('admin');
  return (
    <section role="alert" className="rounded-lg border border-error/30 bg-card p-6">
      <h2 className="text-lg font-semibold text-foreground">{t('loadErrorTitle')}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{t('loadErrorHint')}</p>
      <a
        href={retryHref}
        className="mt-4 inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm font-semibold text-foreground hover:bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {t('loadErrorRetry')}
      </a>
    </section>
  );
}

/** Informacja, że lista pokazuje tylko najnowsze wiersze (brak paginacji — P2-04). */
export function AdminTruncatedNote({ limit }: { limit: number }): React.JSX.Element {
  const t = useTranslations('admin');
  return <p className="text-sm text-muted-foreground">{t('listTruncated', { count: limit })}</p>;
}

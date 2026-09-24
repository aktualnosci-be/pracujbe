import * as React from 'react';
import { AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';

/**
 * AdminLoadError — jawny stan błędu odczytu w panelu admina (#311).
 *
 * Nieudany odczyt service-rolem NIE może wyglądać jak pusta lista („Brak zgłoszeń”) ani jak
 * zera w statystykach — admin mógłby przeoczyć zgłoszenia do moderacji. `role="alert"` ogłasza
 * błąd czytnikom ekranu; link ponowienia to zwykły `<a>` (pełne przeładowanie trasy
 * `force-dynamic`). Teksty z i18n (namespace `admin`), kolory tokenami; karta w stylu
 * „paszport pracy” (#5).
 */
export interface AdminLoadErrorProps {
  /** Pełna ścieżka z prefiksem locale, np. `/pl/admin/firmy?status=pending`. */
  retryHref: string;
}

export function AdminLoadError({ retryHref }: AdminLoadErrorProps): React.JSX.Element {
  const t = useTranslations('admin');
  return (
    <section
      role="alert"
      className="flex min-w-0 flex-wrap items-start gap-4 rounded-3xl border border-error/30 bg-card p-5 sm:p-7"
    >
      <span
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl bg-error/10 text-error-text [&_svg]:size-5"
        aria-hidden="true"
      >
        <AlertTriangle />
      </span>
      <div className="min-w-0 flex-1 basis-56">
        <h2 className="break-words text-xl font-bold text-foreground">{t('loadErrorTitle')}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{t('loadErrorHint')}</p>
        <a
          href={retryHref}
          className="mt-5 inline-flex min-h-11 items-center rounded-xl border border-input bg-card px-5 text-sm font-semibold text-foreground hover:bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {t('loadErrorRetry')}
        </a>
      </div>
    </section>
  );
}

import * as React from 'react';
import { useTranslations } from 'next-intl';

import {
  BTN_SMALL,
  NOTICE,
  NOTICE_TEXT,
  NOTICE_TITLE,
} from '@/components/admin/admin-styles';

/**
 * AdminLoadError — jawny stan błędu odczytu w panelu admina (#311).
 *
 * Nieudany odczyt service-rolem NIE może wyglądać jak pusta lista („Brak zgłoszeń”) ani jak
 * zera w statystykach — admin mógłby przeoczyć zgłoszenia do moderacji. `role="alert"` ogłasza
 * błąd czytnikom ekranu; link ponowienia to zwykły `<a>` (pełne przeładowanie trasy
 * `force-dynamic`). Teksty z i18n (namespace `admin`), kolory tokenami. Wygląd: `.notice`
 * z prototypu „Ludzie i praca” (#5).
 */
export interface AdminLoadErrorProps {
  /** Pełna ścieżka z prefiksem locale, np. `/pl/admin/firmy?status=pending`. */
  retryHref: string;
}

export function AdminLoadError({ retryHref }: AdminLoadErrorProps): React.JSX.Element {
  const t = useTranslations('admin');
  return (
    <section role="alert" className={NOTICE}>
      <div className="min-w-0">
        <h2 className={NOTICE_TITLE}>{t('loadErrorTitle')}</h2>
        <p className={NOTICE_TEXT}>{t('loadErrorHint')}</p>
      </div>
      <a href={retryHref} className={`${BTN_SMALL} border-border text-foreground hover:bg-soft`}>
        {t('loadErrorRetry')}
      </a>
    </section>
  );
}

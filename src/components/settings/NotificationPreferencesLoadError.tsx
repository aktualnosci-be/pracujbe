'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { AlertCircle } from 'lucide-react';

import { useRouter } from '@/i18n/navigation';

/**
 * Stan błędu odczytu preferencji powiadomień (#309). Zastępuje formularz: bez prawdziwych
 * wartości nie pokazujemy przełączników ani przycisku zapisu, żeby nie nadpisać opt-outów
 * wartościami domyślnymi. Ponowienie odświeża dane trasy pod sesją.
 */
export function NotificationPreferencesLoadError(): React.JSX.Element {
  const t = useTranslations('settings');
  const tc = useTranslations('common');
  const router = useRouter();

  return (
    <div role="alert" className="flex items-start gap-3">
      <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-error" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-base font-semibold text-foreground">{t('loadError')}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t('loadErrorHint')}</p>
        <button
          type="button"
          onClick={() => router.refresh()}
          className="mt-4 inline-flex min-h-12 items-center rounded-xl border border-border px-5 text-sm font-semibold text-foreground hover:bg-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {tc('retry')}
        </button>
      </div>
    </div>
  );
}

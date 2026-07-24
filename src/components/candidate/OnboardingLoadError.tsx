'use client';

import * as React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';

/**
 * OnboardingLoadError (P1-07) — stan błędu wczytania profilu w kreatorze onboardingu.
 *
 * KRYTYCZNE: gdy odczyt profilu/relacji zawiedzie, NIE montujemy pustego edytora — zapis kroków
 * jest „replace-all", więc puste pola skasowałyby istniejące dane. Zamiast tego pokazujemy błąd
 * z akcją ponowienia (pełne przeładowanie → ponowny odczyt po stronie serwera).
 */
export function OnboardingLoadError(): React.JSX.Element {
  const t = useTranslations('onboarding');
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-warning/10 text-warning">
        <AlertTriangle className="h-6 w-6" aria-hidden="true" />
      </span>
      <h1 className="text-lg font-semibold text-foreground">{t('loadError')}</h1>
      <p className="text-sm text-muted-foreground">{t('loadErrorHint')}</p>
      <Button type="button" onClick={() => window.location.reload()} className="gap-2">
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
        {t('retry')}
      </Button>
    </div>
  );
}

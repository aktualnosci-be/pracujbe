'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';

import { BTN_PRIMARY } from '@/components/dashboard/panel-styles';
import { MAX_COMPARE_JOBS, MIN_COMPARE_JOBS } from '@/lib/saved-job-compare';
import { cn } from '@/lib/utils';

/**
 * Wybór 2–3 zapisanych ofert do porównania (#816). To zwykły formularz GET (`?porownaj=`), więc
 * działa bez JavaScriptu i można go wysłać z klawiatury; skrypt tylko pilnuje limitu (po trzecim
 * zaznaczeniu pozostałe pola są nieaktywne) i przycisku (aktywny od dwóch ofert). Serwer i tak
 * sam waliduje wybór. Karty (checkboxy `name="porownaj"`) przychodzą jako `children`.
 */
export function SavedJobsCompareForm({ children }: { children: React.ReactNode }): React.JSX.Element {
  const t = useTranslations('dashboard');
  const formRef = React.useRef<HTMLFormElement>(null);
  const [count, setCount] = React.useState(0);

  const sync = React.useCallback(() => {
    const boxes = Array.from(formRef.current?.querySelectorAll<HTMLInputElement>('input[name="porownaj"]') ?? []);
    const checked = boxes.filter((box) => box.checked).length;
    for (const box of boxes) box.disabled = !box.checked && checked >= MAX_COMPARE_JOBS;
    setCount(checked);
  }, []);

  React.useEffect(sync, [sync]);

  return (
    <form ref={formRef} method="get" action="#porownanie" onChange={sync}>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          type="submit"
          disabled={count < MIN_COMPARE_JOBS}
          className={cn(BTN_PRIMARY, 'min-h-11 px-[17px] py-[11px] text-xs disabled:opacity-60')}
        >
          {t('compareSubmit')}
        </button>
        <p role="status" className="text-sm text-muted-foreground">
          {count >= MAX_COMPARE_JOBS ? t('compareLimit') : t('compareHint', { count })}
        </p>
      </div>
      {children}
    </form>
  );
}

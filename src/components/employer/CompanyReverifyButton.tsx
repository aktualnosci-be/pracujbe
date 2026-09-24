'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { BTN_SMALL, NOTICE_TEXT } from '@/components/dashboard/panel-styles';
import { cn } from '@/lib/utils';
import { useRouter } from '@/i18n/navigation';
import { toUserMessageKey, type ErrorCode } from '@/lib/errors';
import { requestCompanyReverification } from '@/lib/actions/company';

/**
 * Ponowne zgłoszenie odrzuconej firmy do weryfikacji (#400). Blokada przycisku podczas
 * zapisu, komunikat błędu z klucza i18n, jasny sukces i odświeżenie widoku (status
 * `pending` → baner „czeka na weryfikację").
 */
export function CompanyReverifyButton(): React.JSX.Element {
  const t = useTranslations('company');
  const tRoot = useTranslations();
  const tCommon = useTranslations('common');
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<ErrorCode | null>(null);
  const [done, setDone] = React.useState(false);

  async function onClick(): Promise<void> {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await requestCompanyReverification();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDone(true);
      router.refresh();
    } catch {
      setError('INTERNAL');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <p className={cn(NOTICE_TEXT, 'my-0')}>{t('reverifyHint')}</p>
      <Button
        type="button"
        size="sm"
        className={cn(BTN_SMALL, 'h-auto whitespace-normal border-primary bg-primary text-primary-foreground hover:bg-primary-dark')}
        onClick={onClick}
        disabled={pending || done}
      >
        {pending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            <span>{tCommon('loading')}</span>
          </>
        ) : (
          <span>{t('reverifySubmit')}</span>
        )}
      </Button>
      {error ? (
        <p role="alert" className="text-[13px] text-error-text">
          {tRoot(toUserMessageKey(error))}
        </p>
      ) : null}
      {done ? <p role="status" className="text-[13px] text-foreground">{t('reverifySuccess')}</p> : null}
    </div>
  );
}

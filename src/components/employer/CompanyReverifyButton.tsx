'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
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
      <p className="text-muted-foreground">{t('reverifyHint')}</p>
      <Button type="button" size="sm" onClick={onClick} disabled={pending || done}>
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
        <p role="alert" className="text-error">
          {tRoot(toUserMessageKey(error))}
        </p>
      ) : null}
      {done ? <p role="status">{t('reverifySuccess')}</p> : null}
    </div>
  );
}

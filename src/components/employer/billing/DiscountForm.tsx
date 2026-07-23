'use client';

import * as React from 'react';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { applyDiscount } from '@/lib/actions/billing';

/**
 * DiscountForm — walidacja kodu rabatowego (panel pracodawcy → płatności, Etap 7h scaffold).
 *
 * Woła server action `applyDiscount` (kod czytany service-rolem, bez redempcji). Po sukcesie
 * pokazuje zniżkę (procentową lub kwotową, sformatowaną wg locale). Realizuje Invariant #11:
 * blokada przycisku w trakcie (useTransition), zachowanie wpisanej wartości po błędzie, jasny
 * komunikat sukcesu/błędu (i18n). Rate limit egzekwuje server action.
 */

type Feedback =
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string }
  | null;

export function DiscountForm(): React.JSX.Element {
  const t = useTranslations('billing');
  const tErrors = useTranslations('errors');
  const locale = useLocale();

  const [code, setCode] = React.useState('');
  const [pending, startTransition] = React.useTransition();
  const [feedback, setFeedback] = React.useState<Feedback>(null);

  const formatMoney = React.useCallback(
    (cents: number, currency: string): string =>
      new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100),
    [locale],
  );

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const value = code.trim();
    if (!value) return;

    startTransition(async () => {
      setFeedback(null);
      try {
        const res = await applyDiscount(value);
        if (res.ok) {
          if (typeof res.percentOff === 'number') {
            setFeedback({
              kind: 'success',
              message: t('discountSuccessPercent', { percent: res.percentOff }),
            });
          } else if (typeof res.amountOffCents === 'number') {
            setFeedback({
              kind: 'success',
              message: t('discountSuccessAmount', {
                amount: formatMoney(res.amountOffCents, res.currency ?? 'EUR'),
              }),
            });
          } else {
            setFeedback({ kind: 'success', message: t('discountSuccessPercent', { percent: 0 }) });
          }
        } else if (res.error === 'RATE_LIMITED') {
          setFeedback({ kind: 'error', message: tErrors('rateLimited') });
        } else {
          // NOT_FOUND / VALIDATION_FAILED / INTERNAL → przyjazny komunikat „nieprawidłowy kod".
          setFeedback({ kind: 'error', message: t('discountInvalid') });
        }
      } catch {
        setFeedback({ kind: 'error', message: t('discountInvalid') });
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="discount-code">{t('discountLabel')}</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id="discount-code"
            type="text"
            autoComplete="off"
            inputMode="text"
            placeholder={t('discountPlaceholder')}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            className="sm:max-w-xs"
          />
          <Button type="submit" disabled={pending || code.trim().length === 0}>
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            {t('discountApply')}
          </Button>
        </div>
      </div>

      {feedback?.kind === 'success' ? (
        <div
          role="status"
          className="flex items-start gap-3 rounded-md border border-success/30 bg-success/10 p-3 text-sm text-foreground"
        >
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden="true" />
          <p>{feedback.message}</p>
        </div>
      ) : null}

      {feedback?.kind === 'error' ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-md border border-error/30 bg-error/10 p-3 text-sm text-error"
        >
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <p>{feedback.message}</p>
        </div>
      ) : null}
    </form>
  );
}

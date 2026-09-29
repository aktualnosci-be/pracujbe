'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';

import { BTN_PRIMARY, BTN_RESET, FORM_CONTROL, H2_EXTENDED, PAPER } from '@/components/dashboard/panel-styles';
import { Button } from '@/components/ui/button';
import { routing, localeNames, type Locale } from '@/i18n/routing';
import { setEmailLocaleAction } from '@/lib/actions/email-locale';
import { toUserMessageKey, type ErrorCode } from '@/lib/errors';
import { cn } from '@/lib/utils';

/**
 * EmailLocaleSettings — język e-maili i powiadomień (#1049, Invariant #1) w ustawieniach
 * kandydata i pracodawcy.
 *
 * Język komunikacji nie zależy od języka interfejsu ani przeglądarki: to wybór zapisany na koncie
 * (`profiles.preferred_locale`, RPC `set_my_email_locale`). Zmiana dotyczy kolejnych wiadomości.
 * Jedno żądanie naraz, komunikat sukcesu `role="status"`, błąd `role="alert"` z kodu (Invariant
 * #8), wybór zostaje po błędzie (Invariant #11).
 */
export function EmailLocaleSettings({ initial }: { initial: Locale }): React.JSX.Element {
  const t = useTranslations('settings');
  const tRoot = useTranslations();
  const [value, setValue] = React.useState<Locale>(initial);
  const [saved, setSaved] = React.useState<Locale>(initial);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<ErrorCode | null>(null);
  const [success, setSuccess] = React.useState(false);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (pending) return;
    setError(null);
    setSuccess(false);
    setPending(true);
    try {
      const result = await setEmailLocaleAction(value);
      if (result.ok) {
        setSaved(result.locale);
        setSuccess(true);
      } else {
        setError(result.error);
      }
    } catch {
      setError('INTERNAL');
    } finally {
      setPending(false);
    }
  };

  return (
    <section aria-labelledby="email-locale-title" className={PAPER}>
      <h2 id="email-locale-title" className={H2_EXTENDED}>
        {t('emailLocaleTitle')}
      </h2>
      <p className="mt-1 text-[15px] leading-[1.7] text-muted-foreground">{t('emailLocaleDescription')}</p>

      <form onSubmit={(event) => void submit(event)} noValidate className="mt-4 space-y-4">
        <div className="flex min-w-0 flex-col gap-[9px]">
          <label htmlFor="email-locale-select" className="text-[13px] font-semibold text-foreground">
            {t('emailLocaleLabel')}
          </label>
          <select
            id="email-locale-select"
            value={value}
            disabled={pending}
            onChange={(event) => {
              setValue(event.target.value as Locale);
              setSuccess(false);
            }}
            className={FORM_CONTROL}
          >
            {routing.locales.map((loc) => (
              <option key={loc} value={loc} lang={loc}>
                {localeNames[loc]}
              </option>
            ))}
          </select>
        </div>
        <Button
          type="submit"
          className={cn(BTN_PRIMARY, BTN_RESET)}
          disabled={pending || value === saved}
          aria-busy={pending || undefined}
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {pending ? t('emailLocaleSaving') : t('emailLocaleSave')}
        </Button>
      </form>

      <div aria-live="polite">
        {error ? (
          <div
            role="alert"
            className="mt-4 flex items-start gap-3 rounded-md border border-error/30 bg-error/10 p-3 text-sm text-error"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p>{tRoot(toUserMessageKey(error))}</p>
          </div>
        ) : null}
        {success ? (
          <p
            role="status"
            className="mt-4 flex items-start gap-3 rounded-md border border-success/30 bg-success/10 p-3 text-sm text-success-text"
          >
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {t('emailLocaleSaved')}
          </p>
        ) : null}
      </div>
    </section>
  );
}

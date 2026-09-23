'use client';

import * as React from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslations } from 'next-intl';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { toUserMessageKey, type ErrorCode } from '@/lib/errors';
import { updateNotificationPreferences } from '@/lib/actions/notification-preferences';
import type { NotificationPreferences } from '@/lib/data/notification-preferences';

/**
 * NotificationPreferencesForm — przełączniki preferencji powiadomień (Etap 6, kandydat + pracodawca).
 *
 * Woła server action `updateNotificationPreferences` (zapis pod sesją/RLS). Realizuje Invariant #11:
 * blokada przycisku podczas zapisu (RHF `isSubmitting`), zachowanie ustawień po błędzie (stan RHF),
 * jasny komunikat sukcesu/błędu (i18n), przewinięcie do komunikatu. Wszystkie teksty z namespace
 * `settings`; kody błędów mapowane na komunikaty i18n (bez technikaliów, Invariant #8).
 *
 * Pola to same wartości logiczne (checkboxy), więc walidację robi wyłącznie server action.
 */

/** Nazwy pól = jednocześnie bazy kluczy i18n (`<field>Label` / `<field>Description`). */
type ToggleField = keyof NotificationPreferences;

const EMAIL_FIELDS: readonly ToggleField[] = [
  'emailApplications',
  'emailOffers',
  'emailMessages',
  'emailJobMatches',
  'emailMarketing',
];

/**
 * `pushEnabled` celowo pominięte (#312): Web Push nie jest zaimplementowany, więc kontrolka
 * obiecywałaby funkcję, której nie ma. Wartość z bazy przechodzi bez zmian w `defaultValues`
 * (zapis jej nie zmienia). Przywróć pole razem z realną subskrypcją push.
 */
const CHANNEL_FIELDS: readonly ToggleField[] = ['inAppEnabled'];

export interface NotificationPreferencesFormProps {
  /** Wartości początkowe (odczytane pod sesją; bez env — domyślne). */
  defaultValues: NotificationPreferences;
}

export function NotificationPreferencesForm({
  defaultValues,
}: NotificationPreferencesFormProps): React.JSX.Element {
  const t = useTranslations('settings');
  const tRoot = useTranslations();

  const [serverError, setServerError] = React.useState<ErrorCode | null>(null);
  const [success, setSuccess] = React.useState(false);
  const alertRef = React.useRef<HTMLDivElement | null>(null);

  const {
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<NotificationPreferences>({
    defaultValues,
    mode: 'onSubmit',
  });

  // Przewiń do komunikatu, gdy się pojawi.
  React.useEffect(() => {
    if (serverError || success) {
      alertRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [serverError, success]);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    setSuccess(false);
    try {
      const result = await updateNotificationPreferences(values);
      if (!result.ok) {
        setServerError(result.error);
        return;
      }
      setSuccess(true);
    } catch {
      setServerError('INTERNAL');
    }
  });

  const renderToggle = (field: ToggleField): React.JSX.Element => {
    const id = `pref-${field}`;
    return (
      <div key={field} className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Label htmlFor={id} className="cursor-pointer">
            {t(`${field}Label`)}
          </Label>
          <p className="mt-0.5 text-sm text-muted-foreground">{t(`${field}Description`)}</p>
        </div>
        <Controller
          control={control}
          name={field}
          render={({ field: f }) => (
            <Checkbox
              id={id}
              checked={f.value}
              onCheckedChange={(checked) => f.onChange(checked === true)}
              onBlur={f.onBlur}
              ref={f.ref}
              className="mt-0.5 shrink-0"
            />
          )}
        />
      </div>
    );
  };

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      {serverError ? (
        <div
          ref={alertRef}
          role="alert"
          className="flex items-start gap-3 rounded-md border border-error/30 bg-error/10 p-3 text-sm text-error"
        >
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <p>{tRoot(toUserMessageKey(serverError))}</p>
        </div>
      ) : null}

      {success ? (
        <div
          ref={alertRef}
          role="status"
          className="flex items-start gap-3 rounded-md border border-success/30 bg-success/10 p-3 text-sm text-foreground"
        >
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden="true" />
          <p>{t('savedSuccess')}</p>
        </div>
      ) : null}

      <fieldset className="space-y-4" disabled={isSubmitting}>
        <legend className="text-base font-semibold text-foreground">
          {t('emailSectionTitle')}
        </legend>
        <p className="text-sm text-muted-foreground">{t('emailSectionDescription')}</p>
        <div className="divide-y divide-border rounded-lg border border-border">
          {EMAIL_FIELDS.map((field) => (
            <div key={field} className="p-4">
              {renderToggle(field)}
            </div>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-4" disabled={isSubmitting}>
        <legend className="text-base font-semibold text-foreground">
          {t('channelsSectionTitle')}
        </legend>
        <p className="text-sm text-muted-foreground">{t('channelsSectionDescription')}</p>
        <div className="divide-y divide-border rounded-lg border border-border">
          {CHANNEL_FIELDS.map((field) => (
            <div key={field} className="p-4">
              {renderToggle(field)}
            </div>
          ))}
        </div>
      </fieldset>

      <Button type="submit" size="lg" disabled={isSubmitting} className="w-full sm:w-auto">
        {isSubmitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            <span>{t('saving')}</span>
          </>
        ) : (
          <span>{t('save')}</span>
        )}
      </Button>
    </form>
  );
}

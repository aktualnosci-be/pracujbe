'use client';

import { useHydrated } from '@/components/forms/use-hydrated';
import { NoScriptFormNotice } from '@/components/forms/NoScriptFormNotice';
import * as React from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useLocale, useTranslations } from 'next-intl';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { toUserMessageKey, type ErrorCode } from '@/lib/errors';
import { updateNotificationPreferences } from '@/lib/actions/notification-preferences';
import type { NotificationPreferences } from '@/lib/data/notification-preferences';
import {
  descriptionKey,
  emailFieldsFor,
  type NotificationPreferencesRole,
  type ToggleField,
} from '@/lib/settings/email-preference-fields';

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

// Pola e-mail wg roli i klucze opisów: `@/lib/settings/email-preference-fields` (#357, #45).
export type { NotificationPreferencesRole };

/**
 * `pushEnabled` celowo pominięte (#312, #724): push włącza i wyłącza sekcja urządzeń
 * (`PushNotificationsSettings` — zgoda przeglądarki + rejestr urządzeń, 0219), a akcja zapisu
 * tego formularza bierze `push_enabled` z bazy, nie z wejścia.
 */
const CHANNEL_FIELDS: readonly ToggleField[] = ['inAppEnabled'];

export interface NotificationPreferencesFormProps {
  /** Wartości początkowe (odczytane pod sesją; bez env — domyślne). */
  defaultValues: NotificationPreferences;
  /** Rola panelu — wybiera pola i opisy (#357). Domyślnie kandydat. */
  role?: NotificationPreferencesRole;
  /**
   * Tryb produktu z serwera (#1128/#1145). Brak propsa = tryb ogłoszeniowy (fail-closed): bez
   * kategorii rekrutacyjnych (zgłoszenia, propozycje, wiadomości).
   */
  recruitmentEnabled?: boolean;
}

export function NotificationPreferencesForm({
  defaultValues,
  role = 'candidate',
  recruitmentEnabled = false,
}: NotificationPreferencesFormProps): React.JSX.Element {
  const hydrated = useHydrated();
  const t = useTranslations('settings');
  const tRoot = useTranslations();
  const locale = useLocale();

  const [serverError, setServerError] = React.useState<ErrorCode | null>(null);
  const [success, setSuccess] = React.useState(false);
  const alertRef = React.useRef<HTMLDivElement | null>(null);
  const focusAlertRef = React.useRef(false);

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
      const alert = alertRef.current;
      // #1238: fieldsety i przycisk są `disabled` na czas zapisu, więc przeglądarka zdejmuje z nich
      // fokus (spada na <body>). Po wyniku zapisu fokus trafia na komunikat (zastępuje przywracanie
      // fokusu z #1095, które trafiało na wciąż zablokowaną kontrolkę).
      if (focusAlertRef.current && alert) {
        focusAlertRef.current = false;
        alert.focus({ preventScroll: true });
      }
      alert?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [serverError, success]);

  const onSubmit = handleSubmit(async (values) => {
    focusAlertRef.current = true;
    setServerError(null);
    setSuccess(false);
    try {
      // #45: język i rola wyznaczają wersję pokazanej treści zgody (dowód w bazie).
      const result = await updateNotificationPreferences({ ...values, locale, role });
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
    const descriptionId = `${id}-description`;
    return (
      <div key={field} className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Label htmlFor={id} className="cursor-pointer">
            {t(`${field}Label`)}
          </Label>
          <p id={descriptionId} className="mt-0.5 text-sm text-muted-foreground">
            {t(descriptionKey(field, role))}
          </p>
        </div>
        <Controller
          control={control}
          name={field}
          render={({ field: f }) => (
            <Checkbox
              id={id}
              aria-describedby={descriptionId}
              checked={f.value}
              onCheckedChange={(checked) => {
                f.onChange(checked === true);
                // #1103: „Zapisano” dotyczy poprzedniego stanu — nowa, jeszcze niewysłana zmiana je unieważnia.
                setSuccess(false);
              }}
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
    <form method="post" onSubmit={onSubmit} noValidate className="space-y-6">
      <NoScriptFormNotice />
      {serverError ? (
        <div
          ref={alertRef}
          tabIndex={-1}
          role="alert"
          className="flex items-start gap-3 rounded-md border border-error/30 bg-error/10 p-3 text-sm text-error-text outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <p>{tRoot(toUserMessageKey(serverError))}</p>
        </div>
      ) : null}

      {success ? (
        <div
          ref={alertRef}
          tabIndex={-1}
          role="status"
          className="flex items-start gap-3 rounded-md border border-success/30 bg-success/10 p-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
          {emailFieldsFor(role, recruitmentEnabled).map((field) => (
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

      <Button type="submit" size="lg" disabled={isSubmitting || !hydrated} className="w-full sm:w-auto">
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

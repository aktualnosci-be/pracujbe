'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { BTN_PRIMARY, FORM_CONTROL, FORM_ERROR, FORM_HINT, FORM_LABEL, NOTICE } from '@/components/dashboard/panel-styles';
import { useRouter } from '@/i18n/navigation';
import { routing, type Locale } from '@/i18n/routing';
import { toUserMessageKey, type ErrorCode } from '@/lib/errors';
import { updateCompanyDescriptionLocale } from '@/lib/actions/company-description-locale';

/**
 * CompanyDescriptionLocaleForm — język, w którym firma napisała opis (#708, 0975, w
 * `/employer/firma`, owner/admin). Publiczny profil oznacza opis tym językiem i mówi
 * odwiedzającemu, gdy opis jest w innym języku niż strona. Invariant #11: blokada przycisku
 * podczas zapisu, błąd przy polu, zachowanie wyboru po błędzie, jasny sukces.
 */

export interface CompanyDescriptionLocaleFormProps {
  companyId: string;
  locale: Locale | null;
}

export function CompanyDescriptionLocaleForm({
  companyId,
  locale,
}: CompanyDescriptionLocaleFormProps): React.JSX.Element {
  const t = useTranslations('company');
  const tLang = useTranslations('languageNames');
  const tRoot = useTranslations();
  const router = useRouter();
  const idBase = React.useId();
  const selectId = `${idBase}-locale`;
  const hintId = `${idBase}-hint`;
  const errorId = `${idBase}-error`;

  const [value, setValue] = React.useState<string>(locale ?? '');
  const [fieldError, setFieldError] = React.useState<'descriptionEmpty' | null>(null);
  const [serverError, setServerError] = React.useState<ErrorCode | null>(null);
  const [success, setSuccess] = React.useState<'saved' | 'unchanged' | 'demo' | null>(null);
  const [pending, startTransition] = React.useTransition();
  const selectRef = React.useRef<HTMLSelectElement | null>(null);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setServerError(null);
    setSuccess(null);
    setFieldError(null);
    startTransition(async () => {
      try {
        const res = await updateCompanyDescriptionLocale(companyId, value || null);
        if (!res.ok) {
          if (res.reason === 'descriptionEmpty') {
            setFieldError('descriptionEmpty');
            window.setTimeout(() => selectRef.current?.focus(), 0);
          } else {
            setServerError(res.error);
          }
          return;
        }
        setSuccess(res.demo ? 'demo' : res.outcome);
        router.refresh();
      } catch {
        setServerError('INTERNAL');
      }
    });
  };

  return (
    <form onSubmit={submit} noValidate className="min-w-0 space-y-5" data-testid="company-description-locale-form">
      {serverError ? (
        <div
          role="alert"
          className={cn(NOTICE, 'my-0 items-start justify-start gap-3 border-error/30 bg-error/10 text-error-text max-[600px]:flex-row')}
        >
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <p>{tRoot(toUserMessageKey(serverError))}</p>
        </div>
      ) : null}
      {success ? (
        <div
          role="status"
          className={cn(NOTICE, 'my-0 items-start justify-start gap-3 border-success/30 bg-success/10 text-foreground max-[600px]:flex-row')}
        >
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden="true" />
          <p>
            {success === 'demo'
              ? t('descriptionLocaleDemoNotice')
              : success === 'unchanged'
                ? t('descriptionLocaleUnchanged')
                : t('descriptionLocaleSaved')}
          </p>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-col gap-[9px]">
        <label htmlFor={selectId} className={FORM_LABEL}>
          {t('descriptionLocaleLabel')}
        </label>
        <select
          ref={selectRef}
          id={selectId}
          name="descriptionLocale"
          className={FORM_CONTROL}
          value={value}
          disabled={pending}
          aria-invalid={fieldError ? true : undefined}
          aria-describedby={fieldError ? `${hintId} ${errorId}` : hintId}
          onChange={(event) => {
            setValue(event.target.value);
            setFieldError(null);
          }}
        >
          <option value="">{t('descriptionLocaleNone')}</option>
          {routing.locales.map((code) => (
            <option key={code} value={code}>
              {tLang(code)}
            </option>
          ))}
        </select>
        <p id={hintId} className={FORM_HINT}>
          {t('descriptionLocaleHint')}
        </p>
        {fieldError ? (
          <p id={errorId} className={FORM_ERROR}>
            {t('descriptionLocaleDescriptionEmpty')}
          </p>
        ) : null}
      </div>

      <Button type="submit" disabled={pending} aria-busy={pending || undefined} className={BTN_PRIMARY}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
        {pending ? t('descriptionLocaleSaving') : t('descriptionLocaleSubmit')}
      </Button>
    </form>
  );
}

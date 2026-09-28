'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  BTN_PRIMARY,
  CHECKBOX,
  CHECK_ROW,
  FORM_CONTROL,
  FORM_ERROR,
  FORM_HINT,
  FORM_LABEL,
  NOTICE,
} from '@/components/dashboard/panel-styles';
import { useRouter } from '@/i18n/navigation';
import { toUserMessageKey, type ErrorCode } from '@/lib/errors';
import { AGENCY_NUMBER_MAX, agencyNumberError, type AgencyCheckStatus } from '@/lib/job-trust/agency';
import { updateCompanyAgency } from '@/lib/actions/job-trust';

/**
 * CompanyAgencyForm — deklaracja „agencja pracy tymczasowej” i numer uznania regionalnego
 * (0167, w `/employer/firma`, owner/admin firmy). Numer sprawdza ręcznie admin portalu; każda
 * zmiana deklaracji zeruje wynik sprawdzenia. Publicznie oferty firmy dostają etykietę
 * „agencja”. Invariant #11: blokada przycisku podczas zapisu, błąd przy polu z fokusem,
 * zachowanie danych po błędzie, jasny sukces.
 */

export interface CompanyAgencyFormProps {
  companyId: string;
  isAgency: boolean;
  recognitionNumber: string | null;
  checkStatus: AgencyCheckStatus;
}

const CHECK_KEY: Record<AgencyCheckStatus, string> = {
  unchecked: 'agencyCheckUnchecked',
  confirmed: 'agencyCheckConfirmed',
  not_confirmed: 'agencyCheckNotConfirmed',
};

export function CompanyAgencyForm({
  companyId,
  isAgency,
  recognitionNumber,
  checkStatus,
}: CompanyAgencyFormProps): React.JSX.Element {
  const t = useTranslations('company');
  const tRoot = useTranslations();
  const router = useRouter();
  const idBase = React.useId();
  const numberId = `${idBase}-number`;
  const hintId = `${idBase}-hint`;
  const errorId = `${idBase}-error`;

  const [agency, setAgency] = React.useState(isAgency);
  const [number, setNumber] = React.useState(recognitionNumber ?? '');
  const [fieldError, setFieldError] = React.useState<'required' | 'tooLong' | null>(null);
  const [serverError, setServerError] = React.useState<ErrorCode | null>(null);
  const [success, setSuccess] = React.useState<'saved' | 'unchanged' | 'demo' | null>(null);
  const [pending, startTransition] = React.useTransition();
  const numberRef = React.useRef<HTMLInputElement | null>(null);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setServerError(null);
    setSuccess(null);
    if (agency) {
      const local = agencyNumberError(number);
      if (local) {
        setFieldError(local);
        numberRef.current?.focus();
        return;
      }
    }
    setFieldError(null);
    startTransition(async () => {
      try {
        const res = await updateCompanyAgency(companyId, agency, number);
        if (!res.ok) {
          if (res.field === 'number') {
            setFieldError(res.reason ?? 'required');
            window.setTimeout(() => numberRef.current?.focus(), 0);
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
    <form onSubmit={submit} noValidate className="min-w-0 space-y-5" data-testid="company-agency-form">
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
              ? t('agencyDemoNotice')
              : success === 'unchanged'
                ? t('agencyUnchanged')
                : t('agencySaved')}
          </p>
        </div>
      ) : null}

      <label className={CHECK_ROW}>
        <input
          type="checkbox"
          className={CHECKBOX}
          checked={agency}
          disabled={pending}
          onChange={(event) => {
            setAgency(event.target.checked);
            setFieldError(null);
          }}
        />
        <span>{t('agencyLabel')}</span>
      </label>

      {agency ? (
        <div className="flex min-w-0 flex-col gap-[9px]">
          <label htmlFor={numberId} className={FORM_LABEL}>
            {t('agencyNumberLabel')}
          </label>
          <input
            ref={numberRef}
            id={numberId}
            name="agencyRecognitionNumber"
            className={FORM_CONTROL}
            value={number}
            maxLength={AGENCY_NUMBER_MAX + 10}
            disabled={pending}
            required
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={fieldError ? `${hintId} ${errorId}` : hintId}
            onChange={(event) => {
              setNumber(event.target.value);
              if (fieldError) setFieldError(null);
            }}
          />
          <p id={hintId} className={FORM_HINT}>
            {t('agencyNumberHint')}
          </p>
          {fieldError ? (
            <p id={errorId} className={FORM_ERROR}>
              {fieldError === 'tooLong'
                ? t('agencyNumberTooLong', { max: AGENCY_NUMBER_MAX })
                : t('agencyNumberRequired')}
            </p>
          ) : null}
          {isAgency && recognitionNumber ? (
            <p className={FORM_HINT} data-testid="company-agency-check">
              {t(CHECK_KEY[checkStatus])}
            </p>
          ) : null}
        </div>
      ) : null}

      <Button type="submit" disabled={pending} aria-busy={pending || undefined} className={BTN_PRIMARY}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
        {pending ? t('agencySaving') : t('agencySubmit')}
      </Button>
    </form>
  );
}

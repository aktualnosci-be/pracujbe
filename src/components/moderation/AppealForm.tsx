'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { AlertCircle, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useRouter } from '@/i18n/navigation';
import { submitModerationAppeal, submitReportAppeal, type AppealActionResult } from '@/lib/actions/appeals';
import { APPEAL_GROUNDS_MAX, APPEAL_GROUNDS_MIN, appealGroundsError } from '@/lib/admin/appeals';
import type { ModerationFieldError } from '@/lib/admin/moderation';
import { toUserMessageKey, type ErrorCode } from '@/lib/errors';

/**
 * AppealForm — odwołanie od decyzji moderacyjnej (DSA, #43), wspólne dla obu stron:
 *   - `decision` — autor treści w danych firmy (RPC pod sesją),
 *   - `case` — zgłaszający na stronie sprawy (numer + kod dostępu, jak sprawdzenie sprawy);
 *     `restoration` — odwołanie od cofnięcia ograniczenia zamiast od wyniku sprawy (#43, 0109).
 *
 * Formularz otwiera przycisk (odwołanie to świadoma decyzja, nie domyślne pole). Jeden klucz
 * idempotencji na otwarcie formularza: ponowienie po błędzie sieci nie tworzy drugiego
 * odwołania. Blokada przycisku w trakcie zapisu, błąd przy polu z fokusem, treść zachowana
 * po błędzie (Invariant #11). Teksty z namespace podanego w `messages` (company/contentReport).
 */

type Target =
  | { kind: 'decision'; decisionId: string }
  | { kind: 'case'; caseNumber: string; accessCode: string; restoration?: boolean };

const ERROR_KEY: Record<ModerationFieldError, string> = {
  required: 'appealErrorRequired',
  tooShort: 'appealErrorTooShort',
  tooLong: 'appealErrorTooLong',
  scope: 'appealErrorRequired',
};

export interface AppealFormProps {
  target: Target;
  /** Namespace tekstów formularza. */
  messages: 'company' | 'contentReport';
  /** Po wysłaniu (np. ponowne sprawdzenie sprawy); bez niej — odświeżenie strony. */
  onSubmitted?: (reference: string) => void;
}

export function AppealForm({ target, messages, onSubmitted }: AppealFormProps): React.JSX.Element {
  // Dwie statyczne przestrzenie (strażnik wiadomości klienta nie dopuszcza dynamicznej).
  const tCompany = useTranslations('company');
  const tReport = useTranslations('contentReport');
  const t = messages === 'company' ? tCompany : tReport;
  const tRoot = useTranslations();
  const router = useRouter();

  const [open, setOpen] = React.useState(false);
  const [grounds, setGrounds] = React.useState('');
  const [fieldError, setFieldError] = React.useState<ModerationFieldError | null>(null);
  const [serverError, setServerError] = React.useState<ErrorCode | 'NETWORK' | null>(null);
  const [sent, setSent] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const keyRef = React.useRef<string | null>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const alertRef = React.useRef<HTMLDivElement | null>(null);
  const sentRef = React.useRef<HTMLParagraphElement | null>(null);

  const idBase = React.useId();
  const ids = { grounds: `${idBase}-grounds`, hint: `${idBase}-hint`, error: `${idBase}-error` };

  React.useEffect(() => {
    if (open && !pending) textareaRef.current?.focus();
    // Fokus tylko przy otwarciu formularza.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  React.useEffect(() => {
    if (!pending && fieldError) textareaRef.current?.focus();
  }, [pending, fieldError]);
  React.useEffect(() => {
    if (serverError) alertRef.current?.focus();
  }, [serverError]);
  React.useEffect(() => {
    if (sent) sentRef.current?.focus();
  }, [sent]);

  if (sent) {
    return (
      <p
        ref={sentRef}
        tabIndex={-1}
        role="status"
        className="rounded-md border border-success/30 bg-success/10 p-3 text-sm text-success-text outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {t('appealSent', { reference: sent })}
      </p>
    );
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          keyRef.current = crypto.randomUUID();
          setOpen(true);
        }}
      >
        {t('appealAction')}
      </Button>
    );
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (pending) return;
    const invalid = appealGroundsError(grounds);
    setServerError(null);
    if (invalid) {
      setFieldError(invalid);
      textareaRef.current?.focus();
      return;
    }
    setFieldError(null);
    const key = (keyRef.current ??= crypto.randomUUID());
    startTransition(async () => {
      let result: AppealActionResult;
      try {
        result =
          target.kind === 'decision'
            ? await submitModerationAppeal(target.decisionId, grounds, key)
            : await submitReportAppeal({
                caseNumber: target.caseNumber,
                accessCode: target.accessCode,
                grounds,
                idempotencyKey: key,
                target: target.restoration ? 'restoration' : 'decision',
              });
      } catch {
        setServerError('NETWORK');
        return;
      }
      if (result.ok) {
        setSent(result.reference);
        if (onSubmitted) onSubmitted(result.reference);
        else router.refresh();
      } else if (result.field === 'grounds' && result.fieldError) {
        setFieldError(result.fieldError);
      } else {
        setServerError(result.error);
      }
    });
  };

  const errorText = fieldError ? t(ERROR_KEY[fieldError], { min: APPEAL_GROUNDS_MIN, max: APPEAL_GROUNDS_MAX }) : null;
  const serverMessage =
    serverError === 'NETWORK' ? t('appealNetworkError') : serverError ? tRoot(toUserMessageKey(serverError)) : null;

  return (
    <form onSubmit={submit} noValidate className="space-y-3" aria-busy={pending || undefined}>
      {serverMessage ? (
        <div
          ref={alertRef}
          tabIndex={-1}
          role="alert"
          className="flex items-start gap-3 rounded-md border border-error/30 bg-error/10 p-3 text-sm text-error outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <p>{serverMessage}</p>
        </div>
      ) : null}
      <div className="space-y-1.5">
        <label htmlFor={ids.grounds} className="block text-sm font-medium text-foreground">
          {t('appealGroundsLabel')}
        </label>
        <p id={ids.hint} className="text-xs text-muted-foreground">
          {t('appealGroundsHint', { min: APPEAL_GROUNDS_MIN, max: APPEAL_GROUNDS_MAX })}
        </p>
        <textarea
          ref={textareaRef}
          id={ids.grounds}
          name="grounds"
          rows={5}
          required
          maxLength={APPEAL_GROUNDS_MAX}
          value={grounds}
          disabled={pending}
          aria-invalid={errorText ? true : undefined}
          aria-describedby={errorText ? `${ids.hint} ${ids.error}` : ids.hint}
          onChange={(event) => {
            setGrounds(event.target.value);
            setFieldError(null);
          }}
          className="block w-full rounded-xl border border-input bg-card px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[invalid=true]:border-error"
        />
        {errorText ? (
          <p id={ids.error} className="text-sm font-medium text-error-text">
            {errorText}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              <span>{tRoot('common.loading')}</span>
            </>
          ) : (
            <span>{t('appealSubmit')}</span>
          )}
        </Button>
        <Button type="button" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
          {t('appealCancel')}
        </Button>
      </div>
    </form>
  );
}

'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useLocale, useTranslations } from 'next-intl';
import { AlertCircle, Loader2 } from 'lucide-react';

import { AppealForm } from '@/components/moderation/AppealForm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { lookupReportCase } from '@/lib/actions/content-reports';
import type { ReportCaseAppeal, ReportCaseView, ReportStatus } from '@/lib/content-reports/case';
import { createAppDateFormatter } from '@/lib/datetime';
import { toUserMessageKey, type ErrorCode } from '@/lib/errors';
import {
  reportCaseLookupSchema,
  type ReportCaseLookupInput,
  type ReportCategory,
} from '@/lib/validation/content-report';

/**
 * Sprawdzenie statusu sprawy zgłoszenia (#41) — numer sprawy + kod dostępu.
 *
 * Link z e-maila i ekranu sukcesu niesie oba w części `#` adresu (fragment nie trafia do
 * serwera, logów ani nagłówka Referer). Po odczycie usuwamy fragment z paska adresu i od razu
 * sprawdzamy sprawę. Wynik zawiera tylko stan sprawy — bez treści zgłoszenia i danych osobowych.
 */

const STATUS_KEY: Record<ReportStatus, string> = {
  open: 'statusOpen',
  reviewing: 'statusReviewing',
  resolved: 'statusResolved',
  dismissed: 'statusDismissed',
};

const APPEAL_STATUS_KEY: Record<string, string> = {
  pending: 'appealStatusPending',
  upheld: 'appealStatusUpheld',
  reversed: 'appealStatusReversed',
};

const CATEGORY_KEY: Record<ReportCategory, string> = {
  fraud: 'categoryFraud',
  impersonation: 'categoryImpersonation',
  discrimination: 'categoryDiscrimination',
  illegal_conditions: 'categoryIllegalConditions',
  data_misuse: 'categoryDataMisuse',
  other: 'categoryOther',
};

function readFragment(): ReportCaseLookupInput | null {
  const hash = window.location.hash.replace(/^#/, '');
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  const caseNumber = params.get('nr');
  const accessCode = params.get('kod');
  if (!caseNumber || !accessCode) return null;
  return { caseNumber, accessCode };
}

export function ReportCaseLookup(): React.JSX.Element {
  const t = useTranslations('contentReport');
  const tRoot = useTranslations();
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const formatDate = React.useMemo(() => createAppDateFormatter(locale, { withTime: true }), [locale]);

  const [report, setReport] = React.useState<ReportCaseView | null>(null);
  const [serverError, setServerError] = React.useState<ErrorCode | 'NETWORK' | null>(null);
  const alertRef = React.useRef<HTMLDivElement | null>(null);
  const resultRef = React.useRef<HTMLHeadingElement | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<ReportCaseLookupInput>({
    resolver: zodResolver(reportCaseLookupSchema),
    defaultValues: { caseNumber: '', accessCode: '' },
  });

  const check = React.useCallback(async (values: ReportCaseLookupInput) => {
    setServerError(null);
    setReport(null);
    try {
      const result = await lookupReportCase(values);
      if (result.ok) setReport(result.report);
      else setServerError(result.error);
    } catch {
      setServerError('NETWORK');
    }
  }, []);

  const onSubmit = handleSubmit(check);

  // Link z e-maila: wypełnij pola, usuń fragment z adresu, sprawdź od razu.
  React.useEffect(() => {
    const fromLink = readFragment();
    if (!fromLink) return;
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    reset(fromLink);
    void handleSubmit(check)();
  }, [check, handleSubmit, reset]);

  React.useEffect(() => {
    if (serverError) alertRef.current?.focus();
  }, [serverError]);
  React.useEffect(() => {
    if (report) resultRef.current?.focus();
  }, [report]);

  const serverMessage =
    serverError === 'NETWORK'
      ? t('lookupNetworkError')
      : serverError === 'NOT_FOUND'
        ? t('lookupNotFound')
        : serverError
          ? tRoot(toUserMessageKey(serverError))
          : null;

  const renderAppeal = (appeal: ReportCaseAppeal, testId: string) => (
    <div className="space-y-1 rounded-md bg-soft p-3 text-sm" data-testid={testId}>
      <h3 className="font-semibold text-foreground">{t('appealStatusTitle', { reference: appeal.reference })}</h3>
      <p className="text-muted-foreground">
        {t(APPEAL_STATUS_KEY[appeal.status] ?? 'appealStatusPending', {
          date: formatDate(
            appeal.status === 'pending'
              ? (appeal.dueAt ?? appeal.submittedAt)
              : (appeal.decidedAt ?? appeal.submittedAt),
          ),
        })}
      </p>
      {appeal.reasoning ? (
        <p className="break-words text-foreground">
          <span className="text-xs text-muted-foreground">{t('appealReasoning')}: </span>
          {appeal.reasoning}
        </p>
      ) : null}
    </div>
  );

  const caseError = errors.caseNumber?.message ? tRoot(String(errors.caseNumber.message)) : null;
  const codeError = errors.accessCode?.message ? tRoot(String(errors.accessCode.message)) : null;

  return (
    <div className="space-y-6">
      <form onSubmit={onSubmit} noValidate className="space-y-4" aria-busy={isSubmitting || undefined}>
        {serverMessage ? (
          <div
            ref={alertRef}
            tabIndex={-1}
            role="alert"
            className="flex items-start gap-3 rounded-md border border-error/30 bg-error/10 p-3 text-sm text-error outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <p>{serverMessage}</p>
          </div>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor="case-number">{t('caseNumberLabel')}</Label>
          <Input
            id="case-number"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={caseError ? true : undefined}
            aria-describedby={caseError ? 'case-number-error' : undefined}
            {...register('caseNumber')}
          />
          {caseError ? (
            <p id="case-number-error" className="text-sm text-error">
              {caseError}
            </p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="access-code">{t('accessCodeLabel')}</Label>
          <Input
            id="access-code"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={codeError ? true : undefined}
            aria-describedby={codeError ? 'access-code-error' : undefined}
            {...register('accessCode')}
          />
          {codeError ? (
            <p id="access-code-error" className="text-sm text-error">
              {codeError}
            </p>
          ) : null}
        </div>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              <span>{tCommon('loading')}</span>
            </>
          ) : (
            <span>{t('lookupSubmit')}</span>
          )}
        </Button>
      </form>

      {report ? (
        <section aria-labelledby="case-result-title" className="space-y-4 rounded-lg border border-border bg-card p-5">
          <h2
            id="case-result-title"
            ref={resultRef}
            tabIndex={-1}
            className="break-all text-lg font-semibold text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t('resultTitle', { caseNumber: report.caseNumber })}
          </h2>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">{t('statusLabel')}</dt>
              <dd className="font-medium text-foreground" data-testid="report-case-status">
                {t(STATUS_KEY[report.status])}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('targetTypeLabel')}</dt>
              <dd className="font-medium text-foreground">
                {report.targetType === 'job' ? t('targetTypeJob') : t('targetTypeCompany')}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('categoryLegend')}</dt>
              <dd className="font-medium text-foreground">{t(CATEGORY_KEY[report.category])}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('submittedAtLabel')}</dt>
              <dd className="font-medium text-foreground">
                <time dateTime={report.createdAt}>{formatDate(report.createdAt)}</time>
              </dd>
            </div>
            {report.outcome ? (
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">{t('outcomeLabel')}</dt>
                <dd className="font-medium text-foreground" data-testid="report-case-outcome">
                  {t(report.outcome === 'action_taken' ? 'outcomeActionTaken' : 'outcomeNoAction')}
                </dd>
              </div>
            ) : null}
            {report.dueAt ? (
              <div>
                <dt className="text-muted-foreground">{t('dueAtLabel')}</dt>
                <dd className="font-medium text-foreground">
                  <time dateTime={report.dueAt}>{formatDate(report.dueAt)}</time>
                </dd>
              </div>
            ) : null}
          </dl>
          {report.appeal ? (
            renderAppeal(report.appeal, 'report-case-appeal')
          ) : report.appealState === 'OK' ? (
            <div className="space-y-3" data-testid="report-case-appeal-form">
              <h3 className="text-sm font-semibold text-foreground">{t('appealTitle')}</h3>
              <p className="text-sm text-muted-foreground">
                {t('appealIntro')}{' '}
                {report.appealDeadline
                  ? t('appealDeadline', { date: formatDate(report.appealDeadline) })
                  : t('appealDeadlineNotStarted')}
              </p>
              <AppealForm
                target={{
                  kind: 'case',
                  caseNumber: getValues('caseNumber'),
                  accessCode: getValues('accessCode'),
                }}
                messages="contentReport"
                onSubmitted={() => undefined}
              />
              <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
                {t('appealLegalPlaceholder')}
              </p>
            </div>
          ) : report.appealState === 'APPEAL_WINDOW_CLOSED' ? (
            <p className="text-sm text-muted-foreground">{t('appealWindowClosed')}</p>
          ) : null}
          {report.restoration ? (
            <div className="space-y-3" data-testid="report-case-restoration">
              <h3 className="text-sm font-semibold text-foreground">{t('restorationTitle')}</h3>
              <p className="text-sm text-muted-foreground">
                {t('restorationInfo', { date: formatDate(report.restoration.restoredAt) })}
              </p>
              {report.restoration.appeal ? (
                renderAppeal(report.restoration.appeal, 'report-case-restoration-appeal')
              ) : report.restoration.appealState === 'OK' ? (
                <div className="space-y-3" data-testid="report-case-restoration-appeal-form">
                  <h4 className="text-sm font-semibold text-foreground">{t('restorationAppealTitle')}</h4>
                  <p className="text-sm text-muted-foreground">
                    {t('restorationAppealIntro')}{' '}
                    {report.restoration.appealDeadline
                      ? t('appealDeadline', { date: formatDate(report.restoration.appealDeadline) })
                      : t('restorationAppealDeadlineNotStarted')}
                  </p>
                  <AppealForm
                    target={{
                      kind: 'case',
                      caseNumber: getValues('caseNumber'),
                      accessCode: getValues('accessCode'),
                      restoration: true,
                    }}
                    messages="contentReport"
                    onSubmitted={() => undefined}
                  />
                  <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
                    {t('appealLegalPlaceholder')}
                  </p>
                </div>
              ) : report.restoration.appealState === 'APPEAL_WINDOW_CLOSED' ? (
                <p className="text-sm text-muted-foreground">{t('restorationAppealWindowClosed')}</p>
              ) : null}
            </div>
          ) : null}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground">{t('historyTitle')}</h3>
            <ol className="space-y-1 text-sm">
              {report.events.map((event, index) => (
                <li key={`${event.at}-${index}`} className="flex flex-wrap gap-x-2 text-foreground">
                  <time dateTime={event.at} className="text-muted-foreground">
                    {formatDate(event.at)}
                  </time>
                  <span>
                    {event.type === 'submitted'
                      ? t('eventSubmitted')
                      : t('eventStatusChanged', {
                          status: event.toStatus ? t(STATUS_KEY[event.toStatus]) : '—',
                        })}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </section>
      ) : null}
    </div>
  );
}

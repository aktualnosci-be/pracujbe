'use client';

import * as React from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useLocale, useTranslations } from 'next-intl';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  isTurnstileWidgetEnabled,
  TurnstileWidget,
  type TurnstileHandle,
} from '@/components/auth/TurnstileWidget';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { submitContentReport } from '@/lib/actions/content-reports';
import { toUserMessageKey, type ErrorCode } from '@/lib/errors';
import { cn } from '@/lib/utils';
import {
  contentReportFormSchema,
  formatAccessCode,
  generateAccessCode,
  REPORT_CATEGORIES,
  REPORT_LIMITS,
  type ContentReportFormValues,
  type ReportTarget,
} from '@/lib/validation/content-report';

/**
 * Publiczny formularz zgłoszenia treści (DSA, #41) — oferta albo firma, także bez konta.
 *
 * Invariant #11: przycisk zablokowany w trakcie wysyłki, dane zostają po błędzie, błędy przy
 * polach (`aria-invalid` + `aria-describedby`), fokus na pierwszym błędnym polu (RHF), jasny
 * sukces z numerem sprawy. Klucz idempotencji i kod dostępu powstają raz na formularz
 * (`useRef`): ponowienie po zerwanym połączeniu zwraca tę samą sprawę, a kod zna tylko
 * zgłaszający (w bazie jest wyłącznie jego skrót).
 */

interface ContentReportFormProps {
  jobId: string;
  jobTitle: string;
  companyName: string;
  jobSlug: string;
  /** Pełny adres oferty — domyślna wartość pola „adres treści”. */
  jobUrl: string;
  initialTarget: ReportTarget;
}

type Submitted = { caseNumber: string; accessCode: string; created: boolean };

const CATEGORY_KEY: Record<(typeof REPORT_CATEGORIES)[number], string> = {
  fraud: 'categoryFraud',
  impersonation: 'categoryImpersonation',
  discrimination: 'categoryDiscrimination',
  illegal_conditions: 'categoryIllegalConditions',
  data_misuse: 'categoryDataMisuse',
  other: 'categoryOther',
};

export function ContentReportForm({
  jobId,
  jobTitle,
  companyName,
  jobSlug,
  jobUrl,
  initialTarget,
}: ContentReportFormProps): React.JSX.Element {
  const t = useTranslations('contentReport');
  const tRoot = useTranslations();
  const tCommon = useTranslations('common');
  const locale = useLocale() as Locale;

  const [target, setTarget] = React.useState<ReportTarget>(initialTarget);
  const [serverError, setServerError] = React.useState<ErrorCode | 'NETWORK' | null>(null);
  const [submitted, setSubmitted] = React.useState<Submitted | null>(null);
  const alertRef = React.useRef<HTMLDivElement | null>(null);
  const successRef = React.useRef<HTMLHeadingElement | null>(null);
  const operationRef = React.useRef<{ idempotencyKey: string; accessCode: string } | null>(null);

  const botCheckEnabled = isTurnstileWidgetEnabled();
  const botCheckRef = React.useRef<TurnstileHandle | null>(null);
  const [botCheckToken, setBotCheckToken] = React.useState<string | null>(null);
  const [botCheckMissing, setBotCheckMissing] = React.useState(false);
  const handleBotCheckToken = React.useCallback((token: string | null) => {
    setBotCheckToken(token);
    if (token) setBotCheckMissing(false);
  }, []);

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<ContentReportFormValues>({
    resolver: zodResolver(contentReportFormSchema),
    defaultValues: {
      details: '',
      contentUrl: jobUrl,
      reporterName: '',
      reporterEmail: '',
    },
    mode: 'onSubmit',
  });

  React.useEffect(() => {
    if (serverError) alertRef.current?.focus();
  }, [serverError]);
  React.useEffect(() => {
    if (submitted) successRef.current?.focus();
  }, [submitted]);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    if (botCheckEnabled && !botCheckToken) {
      setBotCheckMissing(true);
      return;
    }
    operationRef.current ??= {
      idempotencyKey: crypto.randomUUID(),
      accessCode: generateAccessCode(),
    };
    const operation = operationRef.current;

    let result: Awaited<ReturnType<typeof submitContentReport>>;
    try {
      result = await submitContentReport(
        {
          ...values,
          target,
          jobId,
          locale,
          idempotencyKey: operation.idempotencyKey,
          accessCode: operation.accessCode,
        },
        botCheckToken,
      );
    } catch {
      // Zerwane połączenie: dane zostają, ponowienie idzie z tym samym kluczem.
      botCheckRef.current?.reset();
      setServerError('NETWORK');
      return;
    }
    botCheckRef.current?.reset();
    if (!result.ok) {
      setServerError(result.error);
      return;
    }
    setSubmitted({
      caseNumber: result.caseNumber,
      accessCode: operation.accessCode,
      created: result.created,
    });
  });

  if (submitted) {
    const lookupHref = `/zglos-tresc/sprawa#nr=${encodeURIComponent(submitted.caseNumber)}&kod=${submitted.accessCode}`;
    return (
      <section
        role="status"
        aria-labelledby="report-success-title"
        className="space-y-4 rounded-lg border border-success/30 bg-success/10 p-5"
      >
        <h2
          id="report-success-title"
          ref={successRef}
          tabIndex={-1}
          className="flex items-center gap-2 text-lg font-semibold text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <CheckCircle2 className="h-5 w-5 shrink-0 text-success-text" aria-hidden="true" />
          {t('successTitle')}
        </h2>
        <p className="text-sm text-foreground">
          {submitted.created ? t('successBody') : t('successDuplicate')}
        </p>
        <dl className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border border-border bg-card p-3">
            <dt className="text-xs font-medium text-muted-foreground">{t('caseNumberLabel')}</dt>
            <dd className="break-all font-mono text-base font-semibold text-foreground" data-testid="report-case-number">
              {submitted.caseNumber}
            </dd>
          </div>
          <div className="rounded-md border border-border bg-card p-3">
            <dt className="text-xs font-medium text-muted-foreground">{t('accessCodeLabel')}</dt>
            <dd className="break-all font-mono text-base font-semibold text-foreground" data-testid="report-access-code">
              {formatAccessCode(submitted.accessCode)}
            </dd>
          </div>
        </dl>
        <p className="text-sm text-muted-foreground">{t('accessCodeHint')}</p>
        <div className="flex flex-wrap gap-3">
          <Link
            href={lookupHref}
            className="inline-flex min-h-11 items-center font-medium text-foreground underline underline-offset-2 hover:no-underline"
          >
            {t('checkCaseLink')}
          </Link>
          <Link
            href={`/oferty-pracy/${jobSlug}`}
            className="inline-flex min-h-11 items-center font-medium text-foreground underline underline-offset-2 hover:no-underline"
          >
            {t('backToJob')}
          </Link>
        </div>
      </section>
    );
  }

  const fieldError = (name: keyof ContentReportFormValues): string | null => {
    const message = errors[name]?.message;
    return message ? tRoot(String(message)) : null;
  };
  const describedBy = (...ids: Array<string | null | false>) => ids.filter(Boolean).join(' ') || undefined;

  const serverMessage =
    serverError === 'NETWORK'
      ? t('networkError')
      : serverError === 'NOT_FOUND'
        ? t('targetUnavailable')
        : serverError
          ? tRoot(toUserMessageKey(serverError))
          : null;

  const categoryError = fieldError('category');
  const detailsError = fieldError('details');
  const urlError = fieldError('contentUrl');
  const nameError = fieldError('reporterName');
  const emailError = fieldError('reporterEmail');
  const goodFaithError = fieldError('goodFaith');

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6" aria-busy={isSubmitting || undefined}>
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

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-foreground">{t('targetLegend')}</legend>
        {(['job', 'company'] as const).map((value) => (
          <label
            key={value}
            className={cn(
              'flex min-h-11 cursor-pointer items-start gap-3 rounded-md border p-3 text-sm',
              target === value ? 'border-primary bg-soft' : 'border-border',
            )}
          >
            <input
              type="radio"
              name="report-target"
              value={value}
              checked={target === value}
              onChange={() => setTarget(value)}
              className="mt-0.5 h-5 w-5 shrink-0 accent-primary"
            />
            <span className="min-w-0 break-words text-foreground">
              {value === 'job'
                ? t('targetJobOption', { title: jobTitle })
                : t('targetCompanyOption', { company: companyName })}
            </span>
          </label>
        ))}
      </fieldset>

      <fieldset
        role="radiogroup"
        className="space-y-2"
        aria-invalid={categoryError ? true : undefined}
        aria-describedby={describedBy(categoryError && 'category-error')}
      >
        <legend className="text-sm font-medium text-foreground">{t('categoryLegend')}</legend>
        {REPORT_CATEGORIES.map((category) => (
          <label
            key={category}
            className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-border p-3 text-sm"
          >
            <input
              type="radio"
              value={category}
              className="mt-0.5 h-5 w-5 shrink-0 accent-primary"
              {...register('category')}
            />
            <span className="text-foreground">{t(CATEGORY_KEY[category])}</span>
          </label>
        ))}
        {categoryError ? (
          <p id="category-error" className="text-sm text-error">
            {categoryError}
          </p>
        ) : null}
      </fieldset>

      <div className="space-y-1.5">
        <Label htmlFor="report-details">{t('detailsLabel')}</Label>
        <Textarea
          id="report-details"
          rows={6}
          maxLength={REPORT_LIMITS.detailsMax}
          aria-invalid={detailsError ? true : undefined}
          aria-describedby={describedBy('report-details-hint', detailsError && 'report-details-error')}
          {...register('details')}
        />
        <p id="report-details-hint" className="text-xs text-muted-foreground">
          {t('detailsHint', { min: REPORT_LIMITS.detailsMin })}
        </p>
        {detailsError ? (
          <p id="report-details-error" className="text-sm text-error">
            {detailsError}
          </p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="report-url">{t('contentUrlLabel')}</Label>
        <Input
          id="report-url"
          type="url"
          inputMode="url"
          aria-invalid={urlError ? true : undefined}
          aria-describedby={describedBy('report-url-hint', urlError && 'report-url-error')}
          {...register('contentUrl')}
        />
        <p id="report-url-hint" className="text-xs text-muted-foreground">
          {t('contentUrlHint')}
        </p>
        {urlError ? (
          <p id="report-url-error" className="text-sm text-error">
            {urlError}
          </p>
        ) : null}
      </div>

      <fieldset className="space-y-4">
        <legend className="text-sm font-medium text-foreground">{t('contactLegend')}</legend>
        <p className="text-xs text-muted-foreground">{t('contactHint')}</p>
        <div className="space-y-1.5">
          <Label htmlFor="report-name">{t('reporterNameLabel')}</Label>
          <Input
            id="report-name"
            autoComplete="name"
            aria-invalid={nameError ? true : undefined}
            aria-describedby={describedBy(nameError && 'report-name-error')}
            {...register('reporterName')}
          />
          {nameError ? (
            <p id="report-name-error" className="text-sm text-error">
              {nameError}
            </p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="report-email">{t('reporterEmailLabel')}</Label>
          <Input
            id="report-email"
            type="email"
            autoComplete="email"
            aria-invalid={emailError ? true : undefined}
            aria-describedby={describedBy(emailError && 'report-email-error')}
            {...register('reporterEmail')}
          />
          {emailError ? (
            <p id="report-email-error" className="text-sm text-error">
              {emailError}
            </p>
          ) : null}
        </div>
      </fieldset>

      <div className="space-y-1.5">
        <div className="flex items-start gap-2.5">
          <Controller
            name="goodFaith"
            control={control}
            render={({ field }) => (
              <Checkbox
                id="report-good-faith"
                ref={field.ref}
                checked={field.value === true}
                onCheckedChange={(checked) => field.onChange(checked === true)}
                onBlur={field.onBlur}
                aria-invalid={goodFaithError ? true : undefined}
                aria-describedby={describedBy(goodFaithError && 'report-good-faith-error')}
                className="mt-0.5"
              />
            )}
          />
          <Label htmlFor="report-good-faith" className="text-sm font-normal leading-snug text-foreground">
            {t('goodFaithLabel')}
          </Label>
        </div>
        {goodFaithError ? (
          <p id="report-good-faith-error" className="text-sm text-error">
            {goodFaithError}
          </p>
        ) : null}
      </div>

      {botCheckEnabled ? (
        <TurnstileWidget
          ref={botCheckRef}
          flow="report"
          onToken={handleBotCheckToken}
          showRequired={botCheckMissing}
        />
      ) : null}

      <Button type="submit" size="lg" className="w-full sm:w-auto" disabled={isSubmitting}>
        {isSubmitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            <span>{tCommon('loading')}</span>
          </>
        ) : (
          <span>{t('submit')}</span>
        )}
      </Button>
    </form>
  );
}

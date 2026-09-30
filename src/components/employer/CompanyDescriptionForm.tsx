'use client';

import * as React from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { AlertCircle, CheckCircle2, Clock, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  BTN_PRIMARY,
  FORM_CONTROL,
  FORM_HINT,
  FORM_INPUT,
  FORM_LABEL,
  NOTICE,
} from '@/components/dashboard/panel-styles';
import { useRouter } from '@/i18n/navigation';
import { routing, type Locale } from '@/i18n/routing';
import { toUserMessageKey, type ErrorCode } from '@/lib/errors';
import { COMPANY_DESCRIPTION_MAX, type CompanyDescriptionReview } from '@/lib/company-description';
import { companyDescriptionSchema, type CompanyDescriptionInput } from '@/lib/validation/company';
import { updateCompanyDescription, type CompanyDescriptionOutcome } from '@/lib/actions/company';

/**
 * CompanyDescriptionForm — opis firmy widoczny na publicznym profilu (#868, `/employer/firma`).
 *
 * Osobny formularz od `CompanyForm` (nazwa/VAT): zmiana opisu NIE cofa weryfikacji firmy.
 * Limit długości (licznik znaków) i sposób moderacji są widoczne PRZED zapisem: nowy tekst
 * trafia do kolejki admina portalu (`pending`) — publicznie widać dotychczasowy opis, który
 * formularz pokazuje obok; odrzucona propozycja wraca z uzasadnieniem admina do poprawy.
 * Usunięcie opisu (puste pole) wchodzi od razu (`applied`). Podgląd pokazuje tekst tak, jak
 * wyrenderuje go profil (czysty tekst, bez HTML). Język opisu (0201) wybiera się razem z tekstem:
 * idzie z propozycją i staje się językiem opisu przy akceptacji admina (odrzucenie go nie
 * zmienia); ten sam tekst z innym językiem = sama zmiana języka zatwierdzonego opisu, od razu. Realizuje Invariant #11 (blokada przycisku
 * podczas zapisu, błąd przy polu z fokusem, zachowanie danych po błędzie, jasny sukces).
 */

export interface CompanyDescriptionFormProps {
  /** ID firmy, dla której wyrenderowano formularz (#801) — zapis używa TEGO identyfikatora. */
  companyId: string;
  /** Nazwa firmy — nagłówek podglądu profilu. */
  companyName: string;
  /** Wartość pola: propozycja (gdy jest), inaczej zatwierdzony opis. */
  defaultValue: string;
  /** Zatwierdzony (publiczny) opis — pokazywany, gdy propozycja czeka albo została odrzucona. */
  published: string | null;
  /** Stan propozycji (0198) albo null. */
  review: CompanyDescriptionReview | null;
  /** Język zatwierdzonego opisu (0201) albo null (nie wskazano). */
  publishedLocale?: Locale | null;
}

/** Klucz = firma: po przełączeniu aktywnej firmy formularz montuje się od nowa (CC25-01). */
export function CompanyDescriptionForm(props: CompanyDescriptionFormProps): React.JSX.Element {
  return <CompanyDescriptionFormFields key={props.companyId} {...props} />;
}

function CompanyDescriptionFormFields({
  companyId,
  companyName,
  defaultValue,
  published,
  review,
  publishedLocale = null,
}: CompanyDescriptionFormProps): React.JSX.Element {
  const t = useTranslations('company');
  const tLang = useTranslations('languageNames');
  const tRoot = useTranslations();
  const tCommon = useTranslations('common');
  const router = useRouter();

  const [serverError, setServerError] = React.useState<ErrorCode | null>(null);
  const [fieldReason, setFieldReason] = React.useState<'sensitive' | 'tooLong' | null>(null);
  const [success, setSuccess] = React.useState<CompanyDescriptionOutcome | null>(null);
  const [demo, setDemo] = React.useState(false);
  const alertRef = React.useRef<HTMLDivElement | null>(null);

  const resolver = React.useMemo(
    () => zodResolver(companyDescriptionSchema) as Resolver<CompanyDescriptionInput>,
    [],
  );

  const {
    register,
    handleSubmit,
    watch,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<CompanyDescriptionInput>({
    resolver,
    defaultValues: {
      description: defaultValue,
      // Propozycja (oczekująca/odrzucona) niesie własny język; inaczej język zatwierdzonego opisu.
      descriptionLocale: (review ? review.locale : publishedLocale) ?? '',
    },
    mode: 'onSubmit',
  });

  const text = watch('description') ?? '';
  const length = text.trim().length;
  const overLimit = length > COMPANY_DESCRIPTION_MAX;

  React.useEffect(() => {
    if (serverError || success) {
      alertRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [serverError, success]);

  // Przewinięcie do pola i fokus przy pierwszym błędzie walidacji (Invariant #11).
  React.useEffect(() => {
    if (errors.description || fieldReason) setFocus('description');
  }, [errors.description, fieldReason, setFocus]);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    setFieldReason(null);
    setSuccess(null);
    setDemo(false);

    try {
      const result = await updateCompanyDescription(companyId, values);
      if (!result.ok) {
        if (result.field === 'description' && result.reason) {
          setFieldReason(result.reason);
        } else {
          setServerError(result.error);
        }
        return;
      }
      setDemo(result.demo === true);
      setSuccess(result.outcome);
      router.refresh();
    } catch {
      setServerError('INTERNAL');
    }
  });

  const fieldError = errors.description?.message
    ? tRoot(String(errors.description.message))
    : fieldReason === 'sensitive'
      ? t('error.descriptionSensitive')
      : fieldReason === 'tooLong'
        ? t('error.descriptionTooLong')
        : null;

  const previewText = length > 0 ? text.trim() : null;

  return (
    <form onSubmit={onSubmit} noValidate className="min-w-0 space-y-5">
      {serverError ? (
        <div
          ref={alertRef}
          role="alert"
          className={cn(NOTICE, 'my-0 items-start justify-start gap-3 border-error/30 bg-error/10 text-error-text max-[600px]:flex-row')}
        >
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <p>{tRoot(toUserMessageKey(serverError))}</p>
        </div>
      ) : null}

      {success ? (
        <div
          ref={alertRef}
          role="status"
          className={cn(NOTICE, 'my-0 items-start justify-start gap-3 border-success/30 bg-success/10 text-foreground max-[600px]:flex-row')}
        >
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden="true" />
          <p>
            {demo
              ? t('descriptionDemoNotice')
              : success === 'pending'
                ? t('descriptionSubmittedPending')
                : success === 'unchanged'
                  ? t('descriptionUnchanged')
                  : success === 'locale_applied'
                    ? t('descriptionLocaleSaved')
                    : t('descriptionRemovedSuccess')}
          </p>
        </div>
      ) : null}

      {review && !success ? (
        <div
          className={cn(
            NOTICE,
            'my-0 items-start justify-start gap-3 max-[600px]:flex-row',
            review.status === 'rejected'
              ? 'border-error/30 bg-error/10 text-foreground'
              : 'border-border bg-muted text-foreground',
          )}
          data-testid="company-description-review"
        >
          {review.status === 'rejected' ? (
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-error-text" aria-hidden="true" />
          ) : (
            <Clock className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          )}
          <div className="min-w-0 space-y-1">
            <p className="font-semibold">
              {t(review.status === 'rejected' ? 'descriptionReviewRejectedTitle' : 'descriptionReviewPendingTitle')}
            </p>
            {review.status === 'rejected' && review.reason ? (
              <p className="break-words">{t('descriptionReviewRejectedReason', { reason: review.reason })}</p>
            ) : null}
            <p>{t(review.status === 'rejected' ? 'descriptionReviewRejectedHint' : 'descriptionReviewPendingBody')}</p>
            <p className="text-[13px] text-muted-foreground">{t('descriptionPublicLabel')}</p>
            <p className="whitespace-pre-line break-words text-[13px]">{published ?? t('descriptionPublicNone')}</p>
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-col gap-[9px]">
        <Label htmlFor="company-description" className={FORM_LABEL}>
          {t('descriptionLabel')}
        </Label>
        <Textarea
          className={FORM_INPUT}
          id="company-description"
          rows={7}
          placeholder={t('descriptionPlaceholder')}
          aria-invalid={fieldError ? true : undefined}
          aria-describedby={fieldError ? 'company-description-help company-description-error' : 'company-description-help'}
          {...register('description', { onChange: () => setFieldReason(null) })}
        />
        <p
          id="company-description-help"
          className={cn('text-[13px]', overLimit ? 'text-error-text' : 'text-muted-foreground')}
        >
          {t('descriptionCounter', { count: length, max: COMPANY_DESCRIPTION_MAX })} {t('descriptionModerationHint')}
        </p>
        {fieldError ? (
          <p id="company-description-error" role="alert" className="text-[13px] text-error-text">
            {fieldError}
          </p>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-col gap-[9px]">
        <Label htmlFor="company-description-locale" className={FORM_LABEL}>
          {t('descriptionLocaleLabel')}
        </Label>
        <select
          id="company-description-locale"
          className={FORM_CONTROL}
          disabled={isSubmitting}
          aria-describedby="company-description-locale-hint"
          {...register('descriptionLocale')}
        >
          <option value="">{t('descriptionLocaleNone')}</option>
          {routing.locales.map((code) => (
            <option key={code} value={code}>
              {tLang(code)}
            </option>
          ))}
        </select>
        <p id="company-description-locale-hint" className={FORM_HINT}>
          {t('descriptionLocaleHint')}
        </p>
      </div>

      <div className="min-w-0 rounded-[11px] border border-border p-4" data-testid="company-description-preview">
        <p className="text-[13px] font-semibold text-muted-foreground">{t('descriptionPreviewTitle')}</p>
        <p className="mt-2 break-words font-semibold">{companyName}</p>
        <p className="mt-1 max-w-2xl whitespace-pre-line break-words text-muted-foreground">
          {previewText ?? t('descriptionPreviewEmpty')}
        </p>
      </div>

      <Button
        type="submit"
        size="lg"
        disabled={isSubmitting}
        className={cn(BTN_PRIMARY, 'h-auto w-full whitespace-normal sm:w-auto')}
      >
        {isSubmitting ? (
          <>
            <Loader2 className={cn('h-4 w-4 animate-spin')} aria-hidden="true" />
            <span>{tCommon('loading')}</span>
          </>
        ) : (
          <span>{t('descriptionSubmit')}</span>
        )}
      </Button>
    </form>
  );
}

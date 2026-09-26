'use client';

import * as React from 'react';
import Image from 'next/image';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { AlertCircle, CheckCircle2, Clock, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  BTN_PRIMARY,
  FORM_CONTROL,
  FORM_GRID,
  FORM_LABEL,
  INLINE_LINK,
  NOTICE,
} from '@/components/dashboard/panel-styles';
import { useRouter } from '@/i18n/navigation';
import { toUserMessageKey, type ErrorCode } from '@/lib/errors';
import { sameOriginHost, type CompanyLinksReview } from '@/lib/company-links';
import { companyLinksSchema, type CompanyLinksInput } from '@/lib/validation/company';
import { updateCompanyLinks, type CompanyLinksOutcome } from '@/lib/actions/company';

/**
 * CompanyLinksForm — strona WWW i adres logo firmy (#112, w `/employer/firma`).
 *
 * Osobny formularz od `CompanyForm` (nazwa/VAT): zmiana tych pól NIE cofa weryfikacji firmy
 * (baza reaguje tylko na nazwę/VAT — `protect_company_verification`). Oba pola opcjonalne;
 * puste pole = wyczyszczenie adresu. Realizuje Invariant #11 (blokada przycisku podczas
 * zapisu, błędy przy polach z fokusem na pierwszym, zachowanie danych po błędzie, jasny sukces).
 *
 * Zatwierdzanie (0204): nowy adres trafia do kolejki admina portalu (`pending`) — publicznie
 * widać dotychczasowe adresy, które formularz pokazuje obok; odrzucona propozycja wraca z
 * uzasadnieniem admina do poprawy. Usunięcie adresu wchodzi od razu (`applied`).
 *
 * Podgląd logo: `next/image` tylko gdy adres wskazuje na WŁASNY host (jedyny dozwolony w
 * `images.remotePatterns`/CSP `img-src`) — CSP nie jest rozszerzane na dowolne hosty. Dla
 * każdego innego poprawnego adresu formularz pokazuje sam link zamiast obrazka.
 */

export interface CompanyLinksFormProps {
  /** Wartości pól: propozycja (gdy jest), inaczej zatwierdzone adresy. */
  defaultValues: { website: string; logoUrl: string };
  /** Zatwierdzone (publiczne) adresy — pokazywane, gdy propozycja czeka albo została odrzucona. */
  published: { website: string | null; logoUrl: string | null };
  /** Stan propozycji (0204) albo null. */
  review: CompanyLinksReview | null;
  /** Host własnej witryny (`NEXT_PUBLIC_SITE_URL`, bez schematu) — dla podglądu logo. */
  ownHost: string;
}

export function CompanyLinksForm({
  defaultValues,
  published,
  review,
  ownHost,
}: CompanyLinksFormProps): React.JSX.Element {
  const t = useTranslations('company');
  const tRoot = useTranslations();
  const tCommon = useTranslations('common');
  const router = useRouter();

  const [serverError, setServerError] = React.useState<ErrorCode | null>(null);
  const [success, setSuccess] = React.useState<CompanyLinksOutcome | null>(null);
  const [demo, setDemo] = React.useState(false);
  const alertRef = React.useRef<HTMLDivElement | null>(null);

  const resolver = React.useMemo(
    () => zodResolver(companyLinksSchema) as Resolver<CompanyLinksInput>,
    [],
  );

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CompanyLinksInput>({
    resolver,
    defaultValues,
    mode: 'onSubmit',
  });

  const logoUrl = watch('logoUrl');
  const canPreviewLogo = logoUrl ? sameOriginHost(logoUrl, ownHost) : false;

  React.useEffect(() => {
    if (serverError || success) {
      alertRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [serverError, success]);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    setSuccess(null);
    setDemo(false);

    try {
      const result = await updateCompanyLinks(values);
      if (!result.ok) {
        setServerError(result.error);
        return;
      }
      setDemo(result.demo === true);
      setSuccess(result.outcome);
      router.refresh();
    } catch {
      setServerError('INTERNAL');
    }
  });

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
              ? t('linksDemoNotice')
              : success === 'pending'
                ? t('linksSubmittedPending')
                : success === 'unchanged'
                  ? t('linksUnchanged')
                  : t('linksSavedSuccess')}
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
          data-testid="company-links-review"
        >
          {review.status === 'rejected' ? (
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-error-text" aria-hidden="true" />
          ) : (
            <Clock className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          )}
          <div className="min-w-0 space-y-1">
            <p className="font-semibold">
              {t(review.status === 'rejected' ? 'linksReviewRejectedTitle' : 'linksReviewPendingTitle')}
            </p>
            {review.status === 'rejected' && review.reason ? (
              <p className="break-words">{t('linksReviewRejectedReason', { reason: review.reason })}</p>
            ) : null}
            <p>{t(review.status === 'rejected' ? 'linksReviewRejectedHint' : 'linksReviewPendingBody')}</p>
            <dl className="grid gap-x-2 text-[13px] sm:grid-cols-[max-content_1fr]">
              <dt className="text-muted-foreground">
                {t('linksPublicLabel')} — {t('website')}
              </dt>
              <dd className="min-w-0 break-all">{published.website ?? t('linksPublicNone')}</dd>
              <dt className="text-muted-foreground">
                {t('linksPublicLabel')} — {t('logoUrl')}
              </dt>
              <dd className="min-w-0 break-all">{published.logoUrl ?? t('linksPublicNone')}</dd>
            </dl>
          </div>
        </div>
      ) : null}

      <div className={cn(FORM_GRID, 'my-0')}>
        <div className="flex min-w-0 flex-col gap-[9px]">
          <Label htmlFor="company-website" className={FORM_LABEL}>
            {t('website')}
          </Label>
          <Input
            className={FORM_CONTROL}
            id="company-website"
            type="url"
            inputMode="url"
            autoComplete="url"
            placeholder={t('websitePlaceholder')}
            aria-invalid={errors.website ? true : undefined}
            aria-describedby={errors.website ? 'company-website-error' : undefined}
            {...register('website')}
          />
          {errors.website?.message ? (
            <p id="company-website-error" className="text-[13px] text-error-text">
              {tRoot(String(errors.website.message))}
            </p>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-[9px]">
          <Label htmlFor="company-logo-url" className={FORM_LABEL}>
            {t('logoUrl')}
          </Label>
          <Input
            className={FORM_CONTROL}
            id="company-logo-url"
            type="url"
            inputMode="url"
            autoComplete="url"
            placeholder={t('logoUrlPlaceholder')}
            aria-invalid={errors.logoUrl ? true : undefined}
            aria-describedby={errors.logoUrl ? 'company-logo-url-error' : undefined}
            {...register('logoUrl')}
          />
          {errors.logoUrl?.message ? (
            <p id="company-logo-url-error" className="text-[13px] text-error-text">
              {tRoot(String(errors.logoUrl.message))}
            </p>
          ) : null}
          {logoUrl && !errors.logoUrl ? (
            <div className="mt-1 flex min-w-0 items-center gap-3">
              {canPreviewLogo ? (
                <Image
                  src={logoUrl}
                  alt={t('logoPreviewAlt')}
                  width={40}
                  height={40}
                  unoptimized
                  className="h-10 w-10 shrink-0 rounded-[11px] border border-border object-contain"
                />
              ) : (
                <a
                  href={logoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(INLINE_LINK, 'break-all text-xs')}
                >
                  {logoUrl}
                </a>
              )}
            </div>
          ) : null}
        </div>
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
          <span>{t('linksSubmit')}</span>
        )}
      </Button>
    </form>
  );
}

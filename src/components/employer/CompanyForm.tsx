'use client';

import * as React from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  BTN_PRIMARY,
  FORM_CONTROL,
  FORM_GRID,
  FORM_LABEL,
  NOTICE,
  PANEL_P,
} from '@/components/dashboard/panel-styles';
import { useRouter } from '@/i18n/navigation';
import { toUserMessageKey } from '@/lib/errors';
import { teamErrorKey, type TeamError } from '@/lib/team/errors';
import { companyFormSchema, type CompanyFormInput } from '@/lib/validation/company';
import { createAdditionalCompany, createCompany, updateCompany } from '@/lib/actions/company';

/**
 * CompanyForm — formularz danych firmy pracodawcy (Etap 4). Dwa tryby:
 *   - `create` → zakłada firmę (`createCompany`), po sukcesie odświeża widok (formularz →
 *                dane firmy + baner statusu),
 *   - `edit`   → aktualizuje nazwę/VAT (`updateCompany`),
 *   - `add`    → zakłada KOLEJNĄ firmę (`createAdditionalCompany`, #403) i przechodzi do jej
 *                profilu (panel przełącza się na nową firmę).
 *
 * Realizuje Invariant #11: blokada przycisku podczas zapisu, zachowanie danych po błędzie,
 * błędy przy polach (RHF + Zod, te same schematy co serwer), focus do pierwszego błędu,
 * jasny komunikat sukcesu. Kody błędów mapowane na komunikaty i18n (bez technikaliów).
 */

export interface CompanyFormProps {
  mode: 'create' | 'edit' | 'add';
  /** Wartości początkowe (tryb edycji). */
  defaultValues?: { name?: string; vatNumber?: string };
  /** Tryb edycji zweryfikowanej firmy: ostrzeżenie, że zmiana nazwy/VAT wraca do weryfikacji. */
  verified?: boolean;
}

export function CompanyForm({ mode, defaultValues, verified = false }: CompanyFormProps): React.JSX.Element {
  const t = useTranslations('company');
  const tRoot = useTranslations();
  const tCommon = useTranslations('common');
  const tTeam = useTranslations('team');
  const router = useRouter();

  const [serverError, setServerError] = React.useState<TeamError | null>(null);
  const [success, setSuccess] = React.useState(false);
  const [reverification, setReverification] = React.useState(false);
  const [demo, setDemo] = React.useState(false);
  const alertRef = React.useRef<HTMLDivElement | null>(null);

  const resolver = React.useMemo(
    () => zodResolver(companyFormSchema) as Resolver<CompanyFormInput>,
    [],
  );

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CompanyFormInput>({
    resolver,
    defaultValues: {
      name: defaultValues?.name ?? '',
      vatNumber: defaultValues?.vatNumber ?? '',
    },
    mode: 'onSubmit',
  });

  // Przewiń do komunikatu błędu/sukcesu, gdy się pojawi (błędy pól obsługuje focus RHF).
  React.useEffect(() => {
    if (serverError || success) {
      alertRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [serverError, success]);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    setSuccess(false);
    setReverification(false);
    setDemo(false);

    try {
      const input = { name: values.name, vatNumber: values.vatNumber };
      const result =
        mode === 'create'
          ? await createCompany(input)
          : mode === 'add'
            ? await createAdditionalCompany(input)
            : await updateCompany(input);

      if (!result.ok) {
        setServerError(result.error);
        return;
      }

      setReverification('reverificationRequired' in result && result.reverificationRequired === true);
      setDemo('demo' in result && result.demo === true);
      setSuccess(true);
      if (mode === 'add' && !('demo' in result && result.demo)) {
        router.push('/employer/firma');
      }
      // Tryb create: odśwież, by RSC przeładował widok firmy (baner + dane). Tryb edit: odśwież dane.
      router.refresh();
    } catch {
      setServerError('INTERNAL');
    }
  });

  const submitLabel = mode === 'edit' ? t('submitSave') : t('submitCreate');
  const successMessage =
    mode === 'add'
      ? demo
        ? tTeam('demoNotice')
        : tTeam('addCompanyDone')
      : mode === 'create'
      ? t('createdSuccess')
      : reverification
        ? t('savedReverification')
        : t('savedSuccess');

  return (
    <form onSubmit={onSubmit} noValidate className="min-w-0 space-y-5">
      {serverError ? (
        <div
          ref={alertRef}
          role="alert"
          className={cn(NOTICE, 'my-0 items-start justify-start gap-3 border-error/30 bg-error/10 text-error-text max-[600px]:flex-row')}
        >
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <p>{tRoot(teamErrorKey(serverError, toUserMessageKey))}</p>
        </div>
      ) : null}

      {success ? (
        <div
          ref={alertRef}
          role="status"
          className={cn(NOTICE, 'my-0 items-start justify-start gap-3 border-success/30 bg-success/10 text-foreground max-[600px]:flex-row')}
        >
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden="true" />
          <p>{successMessage}</p>
        </div>
      ) : null}

      <div className={cn(FORM_GRID, 'my-0')}>
      <div className="flex min-w-0 flex-col gap-[9px]">
        <Label htmlFor="company-name" className={FORM_LABEL}>{t('name')}</Label>
        <Input
          className={FORM_CONTROL}
          id="company-name"
          type="text"
          autoComplete="organization"
          placeholder={t('namePlaceholder')}
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={errors.name ? 'company-name-error' : undefined}
          {...register('name')}
        />
        {errors.name?.message ? (
          <p id="company-name-error" className="text-[13px] text-error-text">
            {tRoot(String(errors.name.message))}
          </p>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-col gap-[9px]">
        <Label htmlFor="company-vat" className={FORM_LABEL}>{t('vatNumber')}</Label>
        <Input
          className={FORM_CONTROL}
          id="company-vat"
          type="text"
          autoComplete="off"
          placeholder={t('vatPlaceholder')}
          aria-invalid={errors.vatNumber ? true : undefined}
          aria-describedby={
            [errors.vatNumber ? 'company-vat-error' : null, 'company-vat-hint']
              .filter(Boolean)
              .join(' ') || undefined
          }
          {...register('vatNumber')}
        />
        <p id="company-vat-hint" className="text-xs text-muted-foreground">
          {t('vatHint')}
        </p>
        {errors.vatNumber?.message ? (
          <p id="company-vat-error" className="text-[13px] text-error-text">
            {tRoot(String(errors.vatNumber.message))}
          </p>
        ) : null}
      </div>
      </div>

      {mode === 'edit' && verified ? (
        <p className={PANEL_P}>{t('editVerifiedHint')}</p>
      ) : null}

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
          <span>{submitLabel}</span>
        )}
      </Button>
    </form>
  );
}

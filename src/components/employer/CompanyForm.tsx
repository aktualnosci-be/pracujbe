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
import { useRouter } from '@/i18n/navigation';
import { toUserMessageKey, type ErrorCode } from '@/lib/errors';
import { companyFormSchema, type CompanyFormInput } from '@/lib/validation/company';
import { createCompany, updateCompany } from '@/lib/actions/company';

/**
 * CompanyForm — formularz danych firmy pracodawcy (Etap 4). Dwa tryby:
 *   - `create` → zakłada firmę (`createCompany`), po sukcesie odświeża widok (formularz →
 *                dane firmy + baner statusu),
 *   - `edit`   → aktualizuje nazwę/VAT (`updateCompany`).
 *
 * Realizuje Invariant #11: blokada przycisku podczas zapisu, zachowanie danych po błędzie,
 * błędy przy polach (RHF + Zod, te same schematy co serwer), focus do pierwszego błędu,
 * jasny komunikat sukcesu. Kody błędów mapowane na komunikaty i18n (bez technikaliów).
 */

export interface CompanyFormProps {
  mode: 'create' | 'edit';
  /** Wartości początkowe (tryb edycji). */
  defaultValues?: { name?: string; vatNumber?: string };
}

export function CompanyForm({ mode, defaultValues }: CompanyFormProps): React.JSX.Element {
  const t = useTranslations('company');
  const tRoot = useTranslations();
  const tCommon = useTranslations('common');
  const router = useRouter();

  const [serverError, setServerError] = React.useState<ErrorCode | null>(null);
  const [success, setSuccess] = React.useState(false);
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

    try {
      const result =
        mode === 'create'
          ? await createCompany({ name: values.name, vatNumber: values.vatNumber })
          : await updateCompany({ name: values.name, vatNumber: values.vatNumber });

      if (!result.ok) {
        setServerError(result.error);
        return;
      }

      setSuccess(true);
      // Tryb create: odśwież, by RSC przeładował widok firmy (baner + dane). Tryb edit: odśwież dane.
      router.refresh();
    } catch {
      setServerError('INTERNAL');
    }
  });

  const submitLabel = mode === 'create' ? t('submitCreate') : t('submitSave');
  const successMessage = mode === 'create' ? t('createdSuccess') : t('savedSuccess');

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
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
          <p>{successMessage}</p>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="company-name">{t('name')}</Label>
        <Input
          id="company-name"
          type="text"
          autoComplete="organization"
          placeholder={t('namePlaceholder')}
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={errors.name ? 'company-name-error' : undefined}
          {...register('name')}
        />
        {errors.name?.message ? (
          <p id="company-name-error" className="text-sm text-error">
            {tRoot(String(errors.name.message))}
          </p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="company-vat">{t('vatNumber')}</Label>
        <Input
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
          <p id="company-vat-error" className="text-sm text-error">
            {tRoot(String(errors.vatNumber.message))}
          </p>
        ) : null}
      </div>

      <Button type="submit" size="lg" disabled={isSubmitting} className="w-full sm:w-auto">
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

'use client';

import * as React from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { z } from 'zod';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';

import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { passwordSchema } from '@/lib/validation/auth';
import type { ErrorCode } from '@/lib/errors';
import { updatePassword } from '@/lib/actions/auth';

/**
 * Formularz ustawienia nowego hasła (client). Dostępny po sesji recovery (użytkownik trafił
 * tu z linku resetu przez `/auth/callback`). Dwa pola hasła (RHF + Zod), wywołuje server action
 * `updatePassword`. Sukces DOPIERO po realnym zapisie → komunikat `auth.passwordUpdated`.
 *
 * Realizuje Invariant #11: blokada przycisku podczas zapisu (brak podwójnego submitu),
 * zachowanie danych po błędzie, błędy przy polach, focus do pierwszego błędu (RHF),
 * jasny komunikat sukcesu. Komunikaty błędów to klucze i18n.
 */

// Ten sam kontrakt co po stronie serwera (min 8, litera+cyfra, zgodne powtórzenie).
const schema = z
  .object({
    password: passwordSchema,
    passwordConfirm: z.string().min(1, 'auth.error.passwordConfirmRequired'),
  })
  .refine((data) => data.password === data.passwordConfirm, {
    path: ['passwordConfirm'],
    message: 'auth.error.passwordMismatch',
  });

type FormValues = z.infer<typeof schema>;

/** Kod błędu (SNAKE_CASE) → klucz i18n `errors.<camelCase>`. */
function errorMessageKey(code: ErrorCode): string {
  const camel = code.toLowerCase().replace(/_([a-z])/g, (_match, ch: string) => ch.toUpperCase());
  return `errors.${camel}`;
}

export function NewPasswordForm(): React.JSX.Element {
  const t = useTranslations('auth');
  const tRoot = useTranslations();
  const tCommon = useTranslations('common');

  const [serverError, setServerError] = React.useState<ErrorCode | null>(null);
  const [success, setSuccess] = React.useState(false);
  const alertRef = React.useRef<HTMLDivElement | null>(null);

  const resolver = React.useMemo(() => zodResolver(schema) as Resolver<FormValues>, []);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver,
    defaultValues: { password: '', passwordConfirm: '' },
    mode: 'onSubmit',
  });

  React.useEffect(() => {
    if (serverError || success) {
      alertRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [serverError, success]);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);

    let result: Awaited<ReturnType<typeof updatePassword>> | undefined;
    try {
      result = await updatePassword({
        password: values.password,
        passwordConfirm: values.passwordConfirm,
      });
    } catch {
      setServerError('INTERNAL');
      return;
    }

    if (result && !result.ok) {
      setServerError(result.error);
      return;
    }
    // Sukces dopiero po realnym zapisie.
    setSuccess(true);
  });

  if (success) {
    return (
      <div className="space-y-6">
        <div
          ref={alertRef}
          role="status"
          className="flex items-start gap-3 rounded-md border border-success/30 bg-success/10 p-4 text-sm text-foreground"
        >
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden="true" />
          <p>{t('passwordUpdated')}</p>
        </div>
        <div className="text-center text-sm">
          <Link
            href="/logowanie"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {t('backToLogin')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {serverError ? (
        <div
          ref={alertRef}
          role="alert"
          className="flex items-start gap-3 rounded-md border border-error/30 bg-error/10 p-3 text-sm text-error"
        >
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <p>{tRoot(errorMessageKey(serverError))}</p>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="password">{t('newPassword')}</Label>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          aria-invalid={errors.password ? true : undefined}
          aria-describedby={errors.password ? 'password-error password-hint' : 'password-hint'}
          {...register('password')}
        />
        <p id="password-hint" className="text-xs text-muted-foreground">
          {t('passwordHint')}
        </p>
        {errors.password?.message ? (
          <p id="password-error" className="text-sm text-error">
            {tRoot(String(errors.password.message))}
          </p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="passwordConfirm">{t('newPasswordConfirm')}</Label>
        <Input
          id="passwordConfirm"
          type="password"
          autoComplete="new-password"
          aria-invalid={errors.passwordConfirm ? true : undefined}
          aria-describedby={errors.passwordConfirm ? 'passwordConfirm-error' : undefined}
          {...register('passwordConfirm')}
        />
        {errors.passwordConfirm?.message ? (
          <p id="passwordConfirm-error" className="text-sm text-error">
            {tRoot(String(errors.passwordConfirm.message))}
          </p>
        ) : null}
      </div>

      <Button type="submit" className="w-full" size="lg" disabled={isSubmitting}>
        {isSubmitting ? (
          <>
            <Loader2 className={cn('h-4 w-4 animate-spin')} aria-hidden="true" />
            <span>{tCommon('loading')}</span>
          </>
        ) : (
          <span>{t('setPassword')}</span>
        )}
      </Button>
    </form>
  );
}

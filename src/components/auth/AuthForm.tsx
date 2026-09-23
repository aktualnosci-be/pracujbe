'use client';

import * as React from 'react';
import {
  Controller,
  useForm,
  type DefaultValues,
  type FieldValues,
  type Resolver,
} from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useLocale, useTranslations } from 'next-intl';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import type { z } from 'zod/v3';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import type { Locale } from '@/i18n/routing';
import type { ErrorCode } from '@/lib/errors';
import {
  loginSchema,
  registerCandidateSchema,
  registerEmployerSchema,
  resetSchema,
} from '@/lib/validation/auth';
import {
  registerCandidate,
  registerEmployer,
  requestPasswordReset,
  signIn,
  type AuthActionResult,
} from '@/lib/actions/auth';

/**
 * Współdzielony formularz uwierzytelniania (client). Obsługuje warianty: logowanie,
 * rejestracja kandydata, rejestracja pracodawcy, reset hasła.
 *
 * Realizuje Invariant #11: blokada przycisku podczas zapisu (brak podwójnego kliknięcia),
 * zachowanie wpisanych danych po błędzie, błędy przy polach, przewijanie/focus do pierwszego
 * błędu (RHF `shouldFocusError`), jasny komunikat sukcesu. Walidacja Zod (te same schematy
 * co po stronie serwera). Komunikaty błędów to klucze i18n — tłumaczone tutaj.
 */

export type AuthFormVariant = 'login' | 'registerCandidate' | 'registerEmployer' | 'reset';

type FieldName =
  | 'email'
  | 'password'
  | 'passwordConfirm'
  | 'firstName'
  | 'lastName'
  | 'companyName';

interface FieldConfig {
  name: FieldName;
  type: 'text' | 'email' | 'password';
  autoComplete: string;
  /** Pokaż podpowiedź o wymaganiach hasła pod tym polem. */
  hint?: boolean;
}

interface AuthFormValues extends FieldValues {
  email?: string;
  password?: string;
  passwordConfirm?: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  agreeTerms?: boolean;
}

const FIELDS: Record<AuthFormVariant, readonly FieldConfig[]> = {
  login: [
    { name: 'email', type: 'email', autoComplete: 'email' },
    { name: 'password', type: 'password', autoComplete: 'current-password' },
  ],
  registerCandidate: [
    { name: 'firstName', type: 'text', autoComplete: 'given-name' },
    { name: 'lastName', type: 'text', autoComplete: 'family-name' },
    { name: 'email', type: 'email', autoComplete: 'email' },
    { name: 'password', type: 'password', autoComplete: 'new-password', hint: true },
    { name: 'passwordConfirm', type: 'password', autoComplete: 'new-password' },
  ],
  registerEmployer: [
    { name: 'companyName', type: 'text', autoComplete: 'organization' },
    { name: 'firstName', type: 'text', autoComplete: 'given-name' },
    { name: 'lastName', type: 'text', autoComplete: 'family-name' },
    { name: 'email', type: 'email', autoComplete: 'email' },
    { name: 'password', type: 'password', autoComplete: 'new-password', hint: true },
    { name: 'passwordConfirm', type: 'password', autoComplete: 'new-password' },
  ],
  reset: [{ name: 'email', type: 'email', autoComplete: 'email' }],
};

const SCHEMAS: Record<AuthFormVariant, z.ZodTypeAny> = {
  login: loginSchema,
  registerCandidate: registerCandidateSchema,
  registerEmployer: registerEmployerSchema,
  reset: resetSchema,
};

const SUBMIT_KEY: Record<AuthFormVariant, string> = {
  login: 'submitLogin',
  registerCandidate: 'submitRegister',
  registerEmployer: 'submitRegister',
  reset: 'resetSubmit',
};

const SHOW_TERMS: Record<AuthFormVariant, boolean> = {
  login: false,
  registerCandidate: true,
  registerEmployer: true,
  reset: false,
};

/** Kod błędu (SNAKE_CASE) → klucz i18n w namespace `errors` (np. AUTH_INVALID_CREDENTIALS → errors.authInvalidCredentials). */
function errorMessageKey(code: ErrorCode): string {
  const camel = code.toLowerCase().replace(/_([a-z])/g, (_match, ch: string) => ch.toUpperCase());
  return `errors.${camel}`;
}

function buildDefaults(variant: AuthFormVariant): DefaultValues<AuthFormValues> {
  const values: AuthFormValues = {};
  for (const field of FIELDS[variant]) {
    values[field.name] = '';
  }
  if (SHOW_TERMS[variant]) {
    values.agreeTerms = false;
  }
  return values as DefaultValues<AuthFormValues>;
}

export interface AuthFormProps {
  variant: AuthFormVariant;
  /** Kod błędu do pokazania od razu (np. nieudany callback e-maila). */
  initialError?: ErrorCode | null;
}

export function AuthForm({ variant, initialError = null }: AuthFormProps): React.JSX.Element {
  const t = useTranslations('auth');
  const tRoot = useTranslations();
  const tCommon = useTranslations('common');
  const locale = useLocale();

  const [serverError, setServerError] = React.useState<ErrorCode | null>(initialError);
  const [success, setSuccess] = React.useState(false);
  const alertRef = React.useRef<HTMLDivElement | null>(null);
  // Fokus na komunikat tylko po wysyłce (nie przy wejściu z `?error=`): przycisk jest `disabled`
  // w trakcie zapisu, więc przeglądarka zdejmuje z niego fokus — bez tego ląduje on na <body>.
  const focusAlertRef = React.useRef(false);

  const resolver = React.useMemo(
    () => zodResolver(SCHEMAS[variant]) as Resolver<AuthFormValues>,
    [variant],
  );

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<AuthFormValues>({
    resolver,
    defaultValues: buildDefaults(variant),
    mode: 'onSubmit',
  });

  // Przewiń do komunikatu błędu/sukcesu, gdy się pojawi (błędy pól obsługuje focus RHF).
  React.useEffect(() => {
    if (serverError || success) {
      const alert = alertRef.current;
      if (focusAlertRef.current && alert) {
        focusAlertRef.current = false;
        alert.focus({ preventScroll: true });
      }
      alert?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [serverError, success]);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    focusAlertRef.current = true;

    let result: AuthActionResult | undefined;
    try {
      switch (variant) {
        case 'login':
          result = await signIn({ email: values.email ?? '', password: values.password ?? '' });
          break;
        case 'registerCandidate':
          result = await registerCandidate({
            email: values.email ?? '',
            password: values.password ?? '',
            passwordConfirm: values.passwordConfirm ?? '',
            firstName: values.firstName ?? '',
            lastName: values.lastName ?? '',
            agreeTerms: true,
            locale: locale as Locale,
          });
          break;
        case 'registerEmployer':
          result = await registerEmployer({
            email: values.email ?? '',
            password: values.password ?? '',
            passwordConfirm: values.passwordConfirm ?? '',
            companyName: values.companyName ?? '',
            firstName: values.firstName ?? '',
            lastName: values.lastName ?? '',
            agreeTerms: true,
            locale: locale as Locale,
          });
          break;
        case 'reset':
          result = await requestPasswordReset({ email: values.email ?? '' });
          break;
      }
    } catch {
      // Nieoczekiwany błąd po stronie serwera (przekierowania NIE trafiają tutaj).
      setServerError('INTERNAL');
      return;
    }

    // Sukces logowania/rejestracji kończy się przekierowaniem po stronie serwera
    // (akcja nie zwraca wartości) — nic więcej nie robimy.
    if (result && !result.ok) {
      setServerError(result.error);
      return;
    }
    if (variant === 'reset') {
      setSuccess(true);
    }
  });

  // Reset (sukces) — pokazujemy neutralny komunikat zamiast formularza.
  if (variant === 'reset' && success) {
    return (
      <div
        ref={alertRef}
        tabIndex={-1}
        role="status"
        className="outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 flex items-start gap-3 rounded-md border border-success/30 bg-success/10 p-4 text-sm text-foreground"
      >
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden="true" />
        <p>{t('resetSuccess')}</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {serverError ? (
        <div
          ref={alertRef}
          tabIndex={-1}
          role="alert"
          className="outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 flex items-start gap-3 rounded-md border border-error/30 bg-error/10 p-3 text-sm text-error"
        >
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <p>{tRoot(errorMessageKey(serverError))}</p>
        </div>
      ) : null}

      {FIELDS[variant].map((field) => {
        const fieldError = errors[field.name];
        const errorId = `${field.name}-error`;
        const hintId = `${field.name}-hint`;
        const describedBy =
          [fieldError ? errorId : null, field.hint ? hintId : null].filter(Boolean).join(' ') ||
          undefined;

        return (
          <div key={field.name} className="space-y-1.5">
            <Label htmlFor={field.name}>{t(field.name)}</Label>
            <Input
              id={field.name}
              type={field.type}
              autoComplete={field.autoComplete}
              aria-invalid={fieldError ? true : undefined}
              aria-describedby={describedBy}
              {...register(field.name)}
            />
            {field.hint ? (
              <p id={hintId} className="text-xs text-muted-foreground">
                {t('passwordHint')}
              </p>
            ) : null}
            {fieldError?.message ? (
              <p id={errorId} className="text-sm text-error">
                {tRoot(String(fieldError.message))}
              </p>
            ) : null}
          </div>
        );
      })}

      {SHOW_TERMS[variant] ? (
        <div className="space-y-1.5">
          <div className="flex items-start gap-2.5">
            <Controller
              name="agreeTerms"
              control={control}
              render={({ field }) => (
                <Checkbox
                  id="agreeTerms"
                  ref={field.ref}
                  checked={field.value === true}
                  onCheckedChange={(checked) => field.onChange(checked === true)}
                  onBlur={field.onBlur}
                  aria-invalid={errors.agreeTerms ? true : undefined}
                  aria-describedby={errors.agreeTerms ? 'agreeTerms-error' : undefined}
                  className="mt-0.5"
                />
              )}
            />
            <Label htmlFor="agreeTerms" className="text-sm font-normal leading-snug text-muted-foreground">
              {t('agreeTerms')}
            </Label>
          </div>
          {errors.agreeTerms?.message ? (
            <p id="agreeTerms-error" className="text-sm text-error">
              {tRoot(String(errors.agreeTerms.message))}
            </p>
          ) : null}
        </div>
      ) : null}

      <Button type="submit" className="w-full" size="lg" disabled={isSubmitting}>
        {isSubmitting ? (
          <>
            <Loader2 className={cn('h-4 w-4 animate-spin')} aria-hidden="true" />
            <span>{tCommon('loading')}</span>
          </>
        ) : (
          <span>{t(SUBMIT_KEY[variant])}</span>
        )}
      </Button>
    </form>
  );
}

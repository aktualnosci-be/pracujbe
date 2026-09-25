'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useLocale, useTranslations } from 'next-intl';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  isTurnstileWidgetEnabled,
  TurnstileWidget,
  type TurnstileHandle,
} from '@/components/auth/TurnstileWidget';
import {
  BTN_PRIMARY,
  BTN_RESET,
  FORM_CONTROL,
  FORM_ERROR,
  FORM_FIELD,
  FORM_HINT,
  FORM_INPUT,
  FORM_LABEL_TEXT,
  PAPER,
} from '@/components/dashboard/panel-styles';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { submitContactMessage } from '@/lib/actions/contact';
import { toUserMessageKey, type ErrorCode } from '@/lib/errors';
import { cn } from '@/lib/utils';
import {
  CONTACT_LIMITS,
  CONTACT_TOPIC_KEY,
  CONTACT_TOPICS,
  contactFormSchema,
  type ContactFormValues,
} from '@/lib/validation/contact';

/**
 * Formularz kontaktu (#61) — także bez konta. Wygląd: `.paper.demo-form` prototypu
 * (`docs/design/people-passport/prototype/extended.css`, jak formularz aplikowania).
 *
 * Invariant #11: przycisk zablokowany w trakcie wysyłki, dane zostają po błędzie, błędy przy
 * polach (`aria-invalid` + `aria-describedby`), fokus na pierwszym błędnym polu (RHF), jasny
 * sukces z numerem referencyjnym. Klucz idempotencji powstaje raz na formularz (`useRef`):
 * ponowienie po zerwanym połączeniu zwraca tę samą wiadomość, bez drugiego e-maila.
 */


type Submitted = { reference: string; created: boolean };

export function ContactForm(): React.JSX.Element {
  const t = useTranslations('contact');
  const tRoot = useTranslations();
  const tCommon = useTranslations('common');
  const locale = useLocale() as Locale;

  const [serverError, setServerError] = React.useState<ErrorCode | 'NETWORK' | null>(null);
  const [submitted, setSubmitted] = React.useState<Submitted | null>(null);
  const alertRef = React.useRef<HTMLDivElement | null>(null);
  const successRef = React.useRef<HTMLHeadingElement | null>(null);
  const idempotencyKeyRef = React.useRef<string | null>(null);

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
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ContactFormValues>({
    resolver: zodResolver(contactFormSchema),
    defaultValues: { message: '', senderName: '', senderEmail: '' },
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
    idempotencyKeyRef.current ??= crypto.randomUUID();

    let result: Awaited<ReturnType<typeof submitContactMessage>>;
    try {
      result = await submitContactMessage(
        { ...values, locale, idempotencyKey: idempotencyKeyRef.current },
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
      if (result.field) {
        setError(result.field, { message: 'contact.error.sensitiveId' }, { shouldFocus: true });
        return;
      }
      setServerError(result.error);
      return;
    }
    setSubmitted({ reference: result.reference, created: result.created });
  });

  if (submitted) {
    return (
      <section role="status" aria-labelledby="contact-success-title" className={PAPER}>
        <h2
          id="contact-success-title"
          ref={successRef}
          tabIndex={-1}
          className="flex items-center gap-2 text-[23px] font-bold leading-[1.3] tracking-[-0.025em] text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <CheckCircle2 className="h-6 w-6 shrink-0 text-success-text" aria-hidden="true" />
          {t('successTitle')}
        </h2>
        <p className="mt-3 text-[15px] leading-[1.7] text-muted-foreground">
          {submitted.created ? t('successBody') : t('successDuplicate')}
        </p>
        <dl className="mt-5">
          <dt className="text-[11px] uppercase tracking-[0.06em] text-muted-foreground">{t('referenceLabel')}</dt>
          <dd className="mt-2 break-all font-mono text-lg font-bold text-foreground" data-testid="contact-reference">
            {submitted.reference}
          </dd>
        </dl>
        <p className={cn(FORM_HINT, 'mt-4')}>{t('referenceHint')}</p>
        <Link href="/pomoc" className="mt-5 inline-flex min-h-11 items-center font-semibold text-primary underline underline-offset-4 hover:no-underline">
          {t('backToHelp')}
        </Link>
      </section>
    );
  }

  const fieldError = (name: keyof ContactFormValues): string | null => {
    const message = errors[name]?.message;
    return message ? tRoot(String(message)) : null;
  };
  const describedBy = (...ids: Array<string | null | false>) => ids.filter(Boolean).join(' ') || undefined;

  const serverMessage =
    serverError === 'NETWORK'
      ? t('networkError')
      : serverError
        ? tRoot(toUserMessageKey(serverError))
        : null;

  const topicError = fieldError('topic');
  const messageError = fieldError('message');
  const nameError = fieldError('senderName');
  const emailError = fieldError('senderEmail');

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className={cn(PAPER, 'space-y-5')}
      aria-busy={isSubmitting || undefined}
      aria-labelledby="contact-form-title"
    >
      <h2 id="contact-form-title" className="text-[23px] font-bold leading-[1.3] tracking-[-0.025em] text-foreground">
        {t('formTitle')}
      </h2>
      {serverMessage ? (
        <div
          ref={alertRef}
          tabIndex={-1}
          role="alert"
          className="flex items-start gap-3 rounded-[11px] border border-error/30 bg-error/10 p-3 text-sm text-error outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <p>{serverMessage}</p>
        </div>
      ) : null}

      <div className={FORM_FIELD}>
        <Label htmlFor="contact-topic" className={FORM_LABEL_TEXT}>
          {t('topicLabel')}
        </Label>
        <select
          id="contact-topic"
          defaultValue=""
          aria-invalid={topicError ? true : undefined}
          aria-describedby={describedBy(topicError && 'contact-topic-error')}
          className={FORM_CONTROL}
          {...register('topic')}
        >
          <option value="" disabled>
            {t('topicPlaceholder')}
          </option>
          {CONTACT_TOPICS.map((topic) => (
            <option key={topic} value={topic}>
              {t(CONTACT_TOPIC_KEY[topic])}
            </option>
          ))}
        </select>
        {topicError ? (
          <p id="contact-topic-error" className={FORM_ERROR}>
            {topicError}
          </p>
        ) : null}
      </div>

      <div className={FORM_FIELD}>
        <Label htmlFor="contact-message" className={FORM_LABEL_TEXT}>
          {t('messageLabel')}
        </Label>
        <Textarea
          id="contact-message"
          rows={7}
          maxLength={CONTACT_LIMITS.messageMax}
          aria-invalid={messageError ? true : undefined}
          aria-describedby={describedBy('contact-message-hint', messageError && 'contact-message-error')}
          className={FORM_INPUT}
          {...register('message')}
        />
        <p id="contact-message-hint" className={FORM_HINT}>
          {t('messageHint', { min: CONTACT_LIMITS.messageMin })}
        </p>
        {messageError ? (
          <p id="contact-message-error" className={FORM_ERROR}>
            {messageError}
          </p>
        ) : null}
      </div>

      <div className={FORM_FIELD}>
        <Label htmlFor="contact-name" className={FORM_LABEL_TEXT}>
          {t('nameLabel')}
        </Label>
        <Input
          id="contact-name"
          autoComplete="name"
          maxLength={CONTACT_LIMITS.nameMax}
          aria-invalid={nameError ? true : undefined}
          aria-describedby={describedBy(nameError && 'contact-name-error')}
          className={FORM_INPUT}
          {...register('senderName')}
        />
        {nameError ? (
          <p id="contact-name-error" className={FORM_ERROR}>
            {nameError}
          </p>
        ) : null}
      </div>

      <div className={FORM_FIELD}>
        <Label htmlFor="contact-email" className={FORM_LABEL_TEXT}>
          {t('emailLabel')}
        </Label>
        <Input
          id="contact-email"
          type="email"
          autoComplete="email"
          maxLength={CONTACT_LIMITS.emailMax}
          aria-invalid={emailError ? true : undefined}
          aria-describedby={describedBy('contact-email-hint', emailError && 'contact-email-error')}
          className={FORM_INPUT}
          {...register('senderEmail')}
        />
        <p id="contact-email-hint" className={FORM_HINT}>
          {t('emailHint')}
        </p>
        {emailError ? (
          <p id="contact-email-error" className={FORM_ERROR}>
            {emailError}
          </p>
        ) : null}
      </div>

      {botCheckEnabled ? (
        <TurnstileWidget
          ref={botCheckRef}
          flow="contact"
          onToken={handleBotCheckToken}
          showRequired={botCheckMissing}
        />
      ) : null}

      <Button type="submit" className={cn(BTN_PRIMARY, BTN_RESET, 'w-full sm:w-auto')} disabled={isSubmitting}>
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

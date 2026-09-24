'use client';

import * as React from 'react';
import { MailCheck, Send } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { isTurnstileWidgetEnabled, TurnstileWidget, type TurnstileHandle } from '@/components/auth/TurnstileWidget';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LegalDocLink } from '@/components/legal/LegalDocLink';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { submitGuestApplication, type GuestApplyField } from '@/lib/actions/guest-applications';
import type { Locale } from '@/i18n/routing';
import { toUserMessageKey, type ErrorCode } from '@/lib/errors';
import { GUEST_MESSAGE_MAX, GUEST_NAME_MAX, looksLikeEmail } from '@/lib/guest-apply/limits';
import { cn } from '@/lib/utils';
import {
  APPLY_AVAILABILITY_OPTIONS,
  APPLY_AVAILABILITY_TO_DB,
  type ApplyAvailabilityOption,
} from '@/lib/validation/application';
import type { PhoneCountry } from '@/lib/validation/phone';
import {
  isScreeningAnswerMissing,
  type ScreeningAnswerValue,
  type ScreeningQuestion,
} from '@/lib/screening/questions';
import { ScreeningQuestionsFields, screeningFieldId } from '@/components/public/ScreeningQuestionsFields';
import {
  BTN_PRIMARY,
  BTN_RESET,
  FORM_ERROR,
  FORM_FIELD,
  FORM_INPUT,
  FORM_LABEL_TEXT,
  FORM_SELECT,
} from '@/components/dashboard/panel-styles';

/**
 * Jednorazowa aplikacja bez konta (#98) — formularz w ApplyModal dla gościa.
 *
 * Minimalne dane: imię i nazwisko, e-mail, zgoda; telefon, dostępność i wiadomość opcjonalne.
 * Po wysłaniu gość dostaje e-mail z linkiem — aplikacja trafia do pracodawcy dopiero po
 * potwierdzeniu adresu (`/aplikacja/potwierdz`). Odpowiedź serwera jest neutralna, więc
 * sukces zawsze brzmi „sprawdź skrzynkę”.
 *
 * Invariant #11: przycisk zablokowany w trakcie wysyłki, dane zostają po błędzie, błędy przy
 * polach (`aria-invalid` + `aria-describedby`) i fokus na pierwszym błędnym polu. Jeden klucz
 * idempotencji na wypełnienie (useRef): ponowienie po zerwanym połączeniu nie tworzy drugiego
 * zgłoszenia ani drugiego e-maila. Turnstile (gdy skonfigurowany) jak w formularzach Auth.
 *
 * Pytania screeningowe (#101): te same pola co w zwykłej aplikacji; pytanie wymagane bez
 * odpowiedzi blokuje wysyłkę przy pytaniu, a ten sam błąd z bazy (`questionId`) też tam trafia.
 */

const DIAL_CODES: ReadonlyArray<{ code: PhoneCountry; dial: string }> = [
  { code: 'PL', dial: '+48' },
  { code: 'BE', dial: '+32' },
  { code: 'NL', dial: '+31' },
  { code: 'FR', dial: '+33' },
  { code: 'DE', dial: '+49' },
  { code: 'LU', dial: '+352' },
];

type FieldErrors = Partial<Record<GuestApplyField, string>>;
type FormError = ErrorCode | 'network';

export interface GuestApplyFormProps {
  jobId: string;
  companyName: string;
  /** Pytania screeningowe oferty (#101); brak = formularz bez pytań. */
  screeningQuestions?: ScreeningQuestion[];
  /** Język treści oferty — tekst pytania, gdy brak tłumaczenia w języku strony. */
  contentLocale?: string;
}

export function GuestApplyForm({
  jobId,
  companyName,
  screeningQuestions = [],
  contentLocale,
}: GuestApplyFormProps): React.JSX.Element {
  const t = useTranslations('guestApply');
  const ta = useTranslations('apply');
  const tRoot = useTranslations();
  const locale = useLocale() as Locale;

  const [fullName, setFullName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [dial, setDial] = React.useState<PhoneCountry>('PL');
  const [phone, setPhone] = React.useState('');
  const [availability, setAvailability] = React.useState<ApplyAvailabilityOption>('immediate');
  const [message, setMessage] = React.useState('');
  const [consent, setConsent] = React.useState(false);
  const [answers, setAnswers] = React.useState<Record<string, ScreeningAnswerValue>>({});
  const [answerErrors, setAnswerErrors] = React.useState<Record<string, true>>({});
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [formError, setFormError] = React.useState<FormError | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [sentTo, setSentTo] = React.useState<string | null>(null);

  const botCheckEnabled = isTurnstileWidgetEnabled();
  const botCheckRef = React.useRef<TurnstileHandle | null>(null);
  const [botCheckToken, setBotCheckToken] = React.useState<string | null>(null);
  const [botCheckMissing, setBotCheckMissing] = React.useState(false);

  const idempotencyKeyRef = React.useRef<string | null>(null);
  const refs = {
    fullName: React.useRef<HTMLInputElement>(null),
    email: React.useRef<HTMLInputElement>(null),
    phone: React.useRef<HTMLInputElement>(null),
    consent: React.useRef<HTMLButtonElement>(null),
  };
  const formErrorRef = React.useRef<HTMLDivElement>(null);
  const sentHeadingRef = React.useRef<HTMLHeadingElement>(null);

  React.useEffect(() => {
    if (formError) formErrorRef.current?.focus();
  }, [formError]);
  React.useEffect(() => {
    if (sentTo) sentHeadingRef.current?.focus();
  }, [sentTo]);

  const focusQuestion = (questionId: string) => {
    const el = document.getElementById(screeningFieldId(questionId));
    el?.focus();
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  const focusField = (field: GuestApplyField) => {
    const el = refs[field].current;
    el?.focus();
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  const availabilityLabel = (value: ApplyAvailabilityOption): string => {
    switch (value) {
      case 'twoWeeks':
        return ta('avail2weeks');
      case 'oneMonth':
        return ta('avail1month');
      case 'flexible':
        return ta('availFlexible');
      default:
        return ta('availImmediate');
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;

    const name = fullName.trim();
    const address = email.trim();
    const next: FieldErrors = {};
    if (!name) next.fullName = t('error.nameRequired');
    if (!address) next.email = t('error.emailRequired');
    else if (!looksLikeEmail(address)) next.email = t('error.emailInvalid');
    if (!consent) next.consent = t('error.privacyNoticeRequired');
    const missing = screeningQuestions.filter(
      (question) => question.required && isScreeningAnswerMissing(answers[question.id]),
    );
    setErrors(next);
    setAnswerErrors(Object.fromEntries(missing.map((question) => [question.id, true as const])));
    // Fokus na pierwszym błędzie w kolejności formularza (Invariant #11): dane, pytania, zgoda.
    const firstField = (['fullName', 'email'] as const).find((field) => next[field]);
    if (firstField) {
      focusField(firstField);
      return;
    }
    if (missing[0]) {
      focusQuestion(missing[0].id);
      return;
    }
    if (next.consent) {
      focusField('consent');
      return;
    }
    // Tylko odpowiedzi na pytania tej oferty, bez pustych wartości (baza liczy je jak brak).
    const answerPayload: Record<string, ScreeningAnswerValue> = {};
    for (const question of screeningQuestions) {
      const value = answers[question.id];
      if (value === undefined || isScreeningAnswerMissing(value)) continue;
      answerPayload[question.id] = typeof value === 'string' ? value.trim() : value;
    }
    if (botCheckEnabled && !botCheckToken) {
      setBotCheckMissing(true);
      return;
    }

    setFormError(null);
    setSubmitting(true);
    idempotencyKeyRef.current ??= crypto.randomUUID();
    const trimmedMessage = message.trim();

    let res: Awaited<ReturnType<typeof submitGuestApplication>>;
    try {
      res = await submitGuestApplication(
        {
          jobId,
          fullName: name,
          email: address,
          phone: phone.trim() || undefined,
          phoneCountry: phone.trim() ? dial : undefined,
          availability: APPLY_AVAILABILITY_TO_DB[availability],
          message: trimmedMessage.length > 0 ? trimmedMessage : undefined,
          locale,
          agreeTerms: true,
          idempotencyKey: idempotencyKeyRef.current,
          ...(Object.keys(answerPayload).length > 0 ? { answers: answerPayload } : {}),
        },
        botCheckToken,
      );
    } catch {
      // Żądanie nie wróciło — dane zostają, ponowienie wyśle ten sam klucz idempotencji.
      botCheckRef.current?.reset();
      setSubmitting(false);
      setFormError('network');
      return;
    }

    // Token Turnstile jest jednorazowy: każda kolejna próba potrzebuje nowego.
    botCheckRef.current?.reset();
    setSubmitting(false);
    if (res.ok) {
      setSentTo(address);
      return;
    }
    if (res.field === 'phone') {
      setErrors({ phone: ta('phoneInvalid') });
      focusField('phone');
    } else if (res.error === 'SCREENING_ANSWER_REQUIRED' && res.questionId) {
      setAnswerErrors({ [res.questionId]: true });
      focusQuestion(res.questionId);
    } else if (res.field) {
      setErrors({ [res.field]: tRoot('errors.validationFailed') });
      focusField(res.field);
    } else {
      setFormError(res.error);
    }
  };

  if (sentTo) {
    return (
      <div role="status" className="space-y-3 rounded-[16px] border border-success/30 bg-success/5 px-5 py-4 text-[13px] leading-[1.6] text-success-text" data-testid="guest-apply-sent">
        <h3 ref={sentHeadingRef} tabIndex={-1} className="flex items-center gap-2 text-[15px] font-[650] text-foreground outline-none">
          <MailCheck className="h-5 w-5 shrink-0" aria-hidden="true" />
          {t('sentTitle')}
        </h3>
        <p className="break-words text-foreground">{t('sentBody', { email: sentTo, company: companyName })}</p>
        <p className="text-muted-foreground">{t('sentSpam')}</p>
      </div>
    );
  }

  const describedBy = (field: GuestApplyField) => (errors[field] ? `guest-apply-${field}-error` : undefined);
  const fieldError = (field: GuestApplyField) =>
    errors[field] ? (
      <p id={`guest-apply-${field}-error`} className={FORM_ERROR}>
        {errors[field]}
      </p>
    ) : null;

  return (
    <form className="flex min-w-0 flex-col gap-5" onSubmit={handleSubmit} noValidate aria-labelledby="guest-apply-title" data-testid="guest-apply-form">
      <div>
        <h3 id="guest-apply-title" className="text-lg font-bold tracking-[-0.025em] text-foreground">{t('formTitle')}</h3>
        <p className="mt-1 text-[13px] leading-[1.6] text-muted-foreground">{t('formHint')}</p>
      </div>

      <div className={FORM_FIELD}>
        <Label htmlFor="guest-apply-name" className={FORM_LABEL_TEXT}>
          {t('fullName')} <span className="text-error" aria-hidden="true">*</span>
        </Label>
        <Input
          ref={refs.fullName}
          id="guest-apply-name"
          autoComplete="name"
          value={fullName}
          maxLength={GUEST_NAME_MAX}
          onChange={(event) => setFullName(event.target.value)}
          aria-required="true"
          aria-invalid={errors.fullName ? true : undefined}
          aria-describedby={describedBy('fullName')}
          className={cn(FORM_INPUT, errors.fullName ? 'border-error' : undefined)}
        />
        {fieldError('fullName')}
      </div>

      <div className={FORM_FIELD}>
        <Label htmlFor="guest-apply-email" className={FORM_LABEL_TEXT}>
          {t('email')} <span className="text-error" aria-hidden="true">*</span>
        </Label>
        <Input
          ref={refs.email}
          id="guest-apply-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-required="true"
          aria-invalid={errors.email ? true : undefined}
          aria-describedby={describedBy('email')}
          className={cn(FORM_INPUT, errors.email ? 'border-error' : undefined)}
        />
        {fieldError('email')}
      </div>

      <div className={FORM_FIELD}>
        <Label htmlFor="guest-apply-phone" className={FORM_LABEL_TEXT}>{t('phoneOptional')}</Label>
        <div className="flex gap-2">
          <Select value={dial} onValueChange={(value) => setDial(value as PhoneCountry)}>
            <SelectTrigger aria-label={ta('dialCode')} className={cn(FORM_SELECT, 'w-28 shrink-0')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DIAL_CODES.map((entry) => (
                <SelectItem key={entry.code} value={entry.code}>
                  {entry.code} {entry.dial}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            ref={refs.phone}
            id="guest-apply-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder={ta('phonePlaceholder')}
            aria-invalid={errors.phone ? true : undefined}
            aria-describedby={describedBy('phone')}
            className={cn(FORM_INPUT, 'flex-1', errors.phone ? 'border-error' : undefined)}
          />
        </div>
        {fieldError('phone')}
      </div>

      <div className={FORM_FIELD}>
        <Label htmlFor="guest-apply-availability" className={FORM_LABEL_TEXT}>{ta('availability')}</Label>
        <Select value={availability} onValueChange={(value) => setAvailability(value as ApplyAvailabilityOption)}>
          <SelectTrigger id="guest-apply-availability" aria-label={ta('availability')} className={FORM_SELECT}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {APPLY_AVAILABILITY_OPTIONS.map((value) => (
              <SelectItem key={value} value={value}>
                {availabilityLabel(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className={FORM_FIELD}>
        <Label htmlFor="guest-apply-message" className={FORM_LABEL_TEXT}>{ta('message')}</Label>
        <Textarea
          className={FORM_INPUT}
          id="guest-apply-message"
          value={message}
          onChange={(event) => setMessage(event.target.value.slice(0, GUEST_MESSAGE_MAX))}
          placeholder={ta('messagePlaceholder')}
          maxLength={GUEST_MESSAGE_MAX}
          rows={3}
        />
        <p className="text-right text-xs tabular-nums text-muted-foreground">
          {message.length} / {GUEST_MESSAGE_MAX}
        </p>
      </div>

      <ScreeningQuestionsFields
        questions={screeningQuestions}
        contentLocale={contentLocale}
        companyName={companyName}
        values={answers}
        errors={answerErrors}
        onChange={(questionId, value) => {
          setAnswers((current) => {
            const nextAnswers = { ...current };
            if (value === undefined) delete nextAnswers[questionId];
            else nextAnswers[questionId] = value;
            return nextAnswers;
          });
          if (answerErrors[questionId] && !isScreeningAnswerMissing(value)) {
            setAnswerErrors((current) => {
              const nextErrors = { ...current };
              delete nextErrors[questionId];
              return nextErrors;
            });
          }
        }}
      />

      <div className={FORM_FIELD}>
        <div className="flex items-start gap-[9px]">
          <Checkbox
            ref={refs.consent}
            id="guest-apply-consent"
            checked={consent}
            onCheckedChange={(value) => setConsent(value === true)}
            aria-required="true"
            aria-invalid={errors.consent ? true : undefined}
            aria-describedby={describedBy('consent')}
            className={errors.consent ? 'border-error' : undefined}
          />
          <Label htmlFor="guest-apply-consent" className="cursor-pointer text-[13px] font-normal leading-[1.5] text-foreground">
            {ta.rich('privacyNoticeAck', {
              privacy: (chunks) => (
                <LegalDocLink href="/polityka-prywatnosci" newTabHint={ta('opensInNewTab')}>
                  {chunks}
                </LegalDocLink>
              ),
            })}
          </Label>
        </div>
        {fieldError('consent')}
      </div>

      {botCheckEnabled ? (
        <TurnstileWidget
          ref={botCheckRef}
          flow="guestApply"
          onToken={(token) => {
            setBotCheckToken(token);
            if (token) setBotCheckMissing(false);
          }}
          showRequired={botCheckMissing}
        />
      ) : null}

      {formError ? (
        <div
          ref={formErrorRef}
          role="alert"
          tabIndex={-1}
          className="rounded-[16px] border border-error/30 bg-error/5 px-5 py-4 text-[13px] text-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {formError === 'network'
            ? ta('errorNetwork')
            : formError === 'DEMO_UNAVAILABLE'
              ? ta('demoUnavailable')
              : formError === 'GUEST_APPLY_UNAVAILABLE'
                ? t('unavailable')
                : formError === 'INTERNAL'
                  ? ta('errorGeneric')
                  : tRoot(toUserMessageKey(formError))}
        </div>
      ) : null}

      <Button type="submit" className={cn(BTN_PRIMARY, BTN_RESET, 'w-full')} disabled={submitting} aria-busy={submitting || undefined}>
        <Send className="h-4 w-4" aria-hidden="true" />
        {submitting ? ta('submitting') : ta('submit')}
      </Button>
    </form>
  );
}


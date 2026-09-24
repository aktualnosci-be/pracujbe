'use client';

import * as React from 'react';
import { MailCheck, Send } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { isTurnstileWidgetEnabled, TurnstileWidget, type TurnstileHandle } from '@/components/auth/TurnstileWidget';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
}

export function GuestApplyForm({ jobId, companyName }: GuestApplyFormProps): React.JSX.Element {
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
    if (!consent) next.consent = t('error.consentRequired');
    setErrors(next);
    const first = (['fullName', 'email', 'consent'] as const).find((field) => next[field]);
    if (first) {
      focusField(first);
      return;
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
    } else if (res.field) {
      setErrors({ [res.field]: tRoot('errors.validationFailed') });
      focusField(res.field);
    } else {
      setFormError(res.error);
    }
  };

  if (sentTo) {
    return (
      <div role="status" className="space-y-3 rounded-2xl bg-success/10 p-4 text-sm text-success-text" data-testid="guest-apply-sent">
        <h3 ref={sentHeadingRef} tabIndex={-1} className="flex items-center gap-2 text-base font-semibold text-foreground outline-none">
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
      <p id={`guest-apply-${field}-error`} className="text-sm text-error">
        {errors[field]}
      </p>
    ) : null;

  return (
    <form className="space-y-4" onSubmit={handleSubmit} noValidate aria-labelledby="guest-apply-title" data-testid="guest-apply-form">
      <div>
        <h3 id="guest-apply-title" className="text-base font-semibold text-foreground">{t('formTitle')}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t('formHint')}</p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="guest-apply-name">
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
          className={errors.fullName ? 'border-error' : undefined}
        />
        {fieldError('fullName')}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="guest-apply-email">
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
          className={errors.email ? 'border-error' : undefined}
        />
        {fieldError('email')}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="guest-apply-phone">{t('phoneOptional')}</Label>
        <div className="flex gap-2">
          <Select value={dial} onValueChange={(value) => setDial(value as PhoneCountry)}>
            <SelectTrigger aria-label={ta('dialCode')} className="w-28 shrink-0">
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
            className={cn('flex-1', errors.phone ? 'border-error' : undefined)}
          />
        </div>
        {fieldError('phone')}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="guest-apply-availability">{ta('availability')}</Label>
        <Select value={availability} onValueChange={(value) => setAvailability(value as ApplyAvailabilityOption)}>
          <SelectTrigger id="guest-apply-availability" aria-label={ta('availability')}>
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

      <div className="space-y-1.5">
        <Label htmlFor="guest-apply-message">{ta('message')}</Label>
        <Textarea
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

      <div className="space-y-1.5">
        <div className="flex items-start gap-2.5">
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
          <Label htmlFor="guest-apply-consent" className="cursor-pointer text-sm font-normal leading-snug text-muted-foreground">
            {ta('consent')}
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
          className="rounded-lg bg-error/10 p-3 text-sm text-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

      <Button type="submit" className="w-full" disabled={submitting} aria-busy={submitting || undefined}>
        <Send className="h-4 w-4" aria-hidden="true" />
        {submitting ? ta('submitting') : ta('submit')}
      </Button>
    </form>
  );
}


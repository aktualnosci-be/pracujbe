'use client';

import * as React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { CheckCircle2, Lock, X, Zap } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';

import { Link } from '@/i18n/navigation';
import { applyToJob } from '@/lib/actions/applications';
import { cn } from '@/lib/utils';
import { loginHref } from '@/lib/validation/auth';
import type { PhoneCountry } from '@/lib/validation/phone';
import { Button, buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Toast } from '@/components/ui/toast';

/**
 * ApplyModal — modal „Aplikuj teraz” (szybka aplikacja) wg makiety 03-job-detail.
 *
 * Renderuje własny wyzwalacz (przycisk granatowy lub outline) i modal na Radix Dialog:
 * telefon (kod kraju + numer), dostępność, wiadomość (licznik 0/500), zgoda RODO oraz
 * „Wyślij aplikację”. Walidacja kliencka blokuje wysyłkę bez telefonu i zgody; przycisk
 * jest zablokowany w trakcie wysyłki (Invariant #11).
 *
 * Zapis realny: idempotentna Server Action `applyToJob` (Invariant #4) woła RPC `apply_to_job`,
 * które tworzy aplikację + kolejkuje e-mail do pracodawcy w jego języku (Invariant #1).
 * Sukces (potwierdzenie + zamknięcie) pokazujemy DOPIERO po `res.ok`. Błędy z warstwy domenowej
 * mapujemy na komunikat i18n (bez technikaliów — Invariant #8): brak logowania → link do logowania.
 */

const MESSAGE_MAX = 500;
const TOAST_MS = 5000;

/**
 * Kody kierunkowe (dane, nie tekst UI). Do serwera trafia numer i kod kraju osobno —
 * normalizacja do E.164 odbywa się w `applyToJob` (#145), bez doklejania prefiksu w kliencie.
 */
const DIAL_CODES: ReadonlyArray<{ code: PhoneCountry; dial: string }> = [
  { code: 'PL', dial: '+48' },
  { code: 'BE', dial: '+32' },
  { code: 'NL', dial: '+31' },
  { code: 'FR', dial: '+33' },
  { code: 'DE', dial: '+49' },
  { code: 'LU', dial: '+352' },
];

const AVAILABILITY = ['immediate', 'twoWeeks', 'oneMonth', 'flexible'] as const;
type Availability = (typeof AVAILABILITY)[number];

/** Mapowanie opcji UI na wartości enuma `availability_status` w bazie (0001). */
const AVAILABILITY_TO_DB: Record<
  Availability,
  'immediate' | 'within_month' | 'within_three_months' | 'flexible'
> = {
  immediate: 'immediate',
  twoWeeks: 'within_month',
  oneMonth: 'within_month',
  flexible: 'flexible',
};

/** Rodzaj błędu formularza (mapowany na komunikat i18n, bez technikaliów). */
type FormError = 'generic' | 'already' | 'login' | 'demo';
type PhoneError = 'required' | 'invalid';

export interface ApplyModalProps {
  jobId: string;
  companyName: string;
  triggerLabel: string;
  triggerHint?: string;
  triggerVariant?: 'default' | 'outline';
  triggerClassName?: string;
  triggerSize?: 'default' | 'lg';
}

export function ApplyModal({
  jobId,
  companyName,
  triggerLabel,
  triggerHint,
  triggerVariant = 'default',
  triggerClassName,
  triggerSize = 'lg',
}: ApplyModalProps): React.JSX.Element {
  const t = useTranslations('apply');
  // Pełna ścieżka z prefiksem języka — po zalogowaniu wracamy na tę ofertę.
  const pathname = usePathname();

  const [open, setOpen] = React.useState(false);
  const [dial, setDial] = React.useState<PhoneCountry>('PL');
  const [phone, setPhone] = React.useState('');
  const [availability, setAvailability] = React.useState<Availability>('immediate');
  const [message, setMessage] = React.useState('');
  const [consent, setConsent] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [errors, setErrors] = React.useState<{ phone?: PhoneError; consent?: boolean }>({});
  const [formError, setFormError] = React.useState<FormError | null>(null);
  const [sent, setSent] = React.useState(false);
  const phoneRef = React.useRef<HTMLInputElement>(null);
  const consentRef = React.useRef<HTMLButtonElement>(null);
  const formErrorRef = React.useRef<HTMLDivElement>(null);

  const availabilityLabel = (value: Availability): string => {
    switch (value) {
      case 'twoWeeks':
        return t('avail2weeks');
      case 'oneMonth':
        return t('avail1month');
      case 'flexible':
        return t('availFlexible');
      default:
        return t('availImmediate');
    }
  };

  const reset = () => {
    setPhone('');
    setAvailability('immediate');
    setMessage('');
    setConsent(false);
    setErrors({});
    setFormError(null);
    setSubmitting(false);
  };

  const handleOpenChange = (next: boolean) => {
    if (next) reset();
    setOpen(next);
  };

  // Po błędzie z serwera przycisk był zablokowany (fokus spadał na kontener dialogu) —
  // przenosimy fokus na komunikat, aby użytkownik klawiatury/czytnika wiedział, co się stało.
  React.useEffect(() => {
    if (formError) formErrorRef.current?.focus();
  }, [formError]);

  React.useEffect(() => {
    if (!sent) return;
    const timer = window.setTimeout(() => setSent(false), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [sent]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;

    const nextErrors = {
      phone: phone.trim().length === 0 ? ('required' as const) : undefined,
      consent: !consent,
    };
    setErrors(nextErrors);
    if (nextErrors.phone || nextErrors.consent) {
      // Fokus + przewinięcie do pierwszego błędnego pola (Invariant #11).
      const firstInvalid = nextErrors.phone ? phoneRef.current : consentRef.current;
      firstInvalid?.focus();
      firstInvalid?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }

    setFormError(null);
    setSubmitting(true);

    const trimmedMessage = message.trim();

    const res = await applyToJob({
      jobId,
      phone: phone.trim(),
      phoneCountry: dial,
      availability: AVAILABILITY_TO_DB[availability],
      message: trimmedMessage.length > 0 ? trimmedMessage : undefined,
      agreeTerms: true,
      idempotencyKey: crypto.randomUUID(),
    });

    // Sukces DOPIERO po realnym zapisie (Invariant #11).
    if (res.ok) {
      setOpen(false);
      setSent(true);
      return;
    }

    setSubmitting(false);
    if (res.field === 'phone') {
      // Błąd numeru przy polu + fokus (Invariant #11), zamiast ogólnego alertu.
      setErrors({ phone: 'invalid' });
      phoneRef.current?.focus();
      phoneRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } else if (res.error === 'DEMO_UNAVAILABLE') {
      setFormError('demo');
    } else if (res.error === 'PERMISSION_DENIED') {
      setFormError('login');
    } else if (res.error === 'APPLICATION_ALREADY_EXISTS') {
      setFormError('already');
    } else {
      setFormError('generic');
    }
  };

  return (
    <>
      <Dialog.Root open={open} onOpenChange={handleOpenChange}>
        <Dialog.Trigger
          className={cn(
            buttonVariants({ variant: triggerVariant, size: triggerSize }),
            triggerHint ? 'h-auto flex-col gap-0.5 py-2.5' : undefined,
            triggerClassName,
          )}
        >
          <span className="flex items-center gap-2 font-medium">
            <Zap className="h-4 w-4" aria-hidden="true" />
            {triggerLabel}
          </span>
          {triggerHint ? (
            <span
              className={cn(
                "text-sm font-normal",
                triggerVariant === "outline" ? "text-muted-foreground" : "text-primary-foreground",
              )}
            >{triggerHint}</span>
          ) : null}
        </Dialog.Trigger>

        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-foreground/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <Dialog.Content
            className="fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-2xl border border-border bg-background p-6 shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <Dialog.Title className="text-lg font-semibold text-foreground">
                  {t('title')}
                </Dialog.Title>
                <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                  {t('subtitle')}
                </Dialog.Description>
              </div>
              <Dialog.Close
                aria-label={t('close')}
                className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'h-9 w-9')}
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </Dialog.Close>
            </div>

            <div className="mb-4 flex items-start gap-2 rounded-lg bg-success/10 p-3 text-sm text-success-text">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{t('profileNote')}</span>
            </div>

            <form className="space-y-4" onSubmit={handleSubmit} noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="apply-phone">
                  {t('phone')} <span className="text-error" aria-hidden="true">*</span>
                </Label>
                <div className="flex gap-2">
                  <Select value={dial} onValueChange={(value) => setDial(value as PhoneCountry)}>
                    <SelectTrigger aria-label={t('dialCode')} className="w-28 shrink-0">
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
                    ref={phoneRef}
                    id="apply-phone"
                    type="tel"
                    inputMode="tel"
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    placeholder={t('phonePlaceholder')}
                    aria-required="true"
                    aria-invalid={errors.phone ? true : undefined}
                    aria-describedby={errors.phone ? 'apply-phone-error' : undefined}
                    className={cn('flex-1', errors.phone ? 'border-error' : undefined)}
                  />
                </div>
                {errors.phone ? (
                  <p id="apply-phone-error" className="text-sm text-error">
                    {errors.phone === 'invalid' ? t('phoneInvalid') : t('phoneRequired')}
                  </p>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="apply-availability">
                  {t('availability')} <span className="text-error" aria-hidden="true">*</span>
                </Label>
                <Select
                  value={availability}
                  onValueChange={(value) => setAvailability(value as Availability)}
                >
                  <SelectTrigger id="apply-availability" aria-label={t('availability')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AVAILABILITY.map((value) => (
                      <SelectItem key={value} value={value}>
                        {availabilityLabel(value)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="apply-message">{t('message')}</Label>
                <Textarea
                  id="apply-message"
                  value={message}
                  onChange={(event) => setMessage(event.target.value.slice(0, MESSAGE_MAX))}
                  placeholder={t('messagePlaceholder')}
                  maxLength={MESSAGE_MAX}
                  rows={4}
                />
                <p className="text-right text-xs tabular-nums text-muted-foreground">
                  {message.length} / {MESSAGE_MAX}
                </p>
              </div>

              <div className="flex items-start gap-2.5">
                <Checkbox
                  ref={consentRef}
                  id="apply-consent"
                  checked={consent}
                  onCheckedChange={(value) => setConsent(value === true)}
                  aria-required="true"
                  aria-invalid={errors.consent ? true : undefined}
                  aria-describedby={errors.consent ? 'apply-consent-error' : undefined}
                  className={errors.consent ? 'border-error' : undefined}
                />
                <Label
                  htmlFor="apply-consent"
                  className="cursor-pointer text-sm font-normal leading-snug text-muted-foreground"
                >
                  {t('consent')}
                </Label>
              </div>
              {errors.consent ? (
                <p id="apply-consent-error" className="-mt-2 text-sm text-error">
                  {t('consentRequired')}
                </p>
              ) : null}

              {formError ? (
                <div
                  ref={formErrorRef}
                  role="alert"
                  tabIndex={-1}
                  className="rounded-lg bg-error/10 p-3 text-sm text-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {formError === 'login' ? (
                    <Link href={loginHref(pathname)} className="font-medium underline">
                      {t('loginRequired')}
                    </Link>
                  ) : formError === 'already' ? (
                    t('alreadyApplied')
                  ) : formError === 'demo' ? (
                    t('demoUnavailable')
                  ) : (
                    t('errorGeneric')
                  )}
                </div>
              ) : null}

              <Button type="submit" className="w-full" disabled={submitting}>
                <Lock className="h-4 w-4" aria-hidden="true" />
                {submitting ? t('submitting') : t('submit')}
              </Button>

              <p className="text-center text-xs text-muted-foreground">
                {t('sentTo', { company: companyName })}
              </p>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {sent ? (
        <div className="fixed bottom-4 right-4 z-[60] w-[calc(100vw-2rem)] max-w-sm">
          <Toast message={t('success')} tone="success" onClose={() => setSent(false)} />
        </div>
      ) : null}
    </>
  );
}

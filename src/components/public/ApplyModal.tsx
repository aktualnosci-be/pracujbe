'use client';

import * as React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { CheckCircle2, LogIn, Lock, UserPlus, X, Zap } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';

import { Link } from '@/i18n/navigation';
import { applyToJob } from '@/lib/actions/applications';
import { cn } from '@/lib/utils';
import { loginHref, registerHref } from '@/lib/auth/next-path';
import { reportApplyStarted } from '@/lib/job-funnel/client';
import { usePublicViewerStatus } from '@/components/public/PublicSavedJobs';
import { GuestApplyForm } from '@/components/public/GuestApplyForm';
import { LegalDocLink } from '@/components/legal/LegalDocLink';
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
import {
  ScreeningQuestionsFields,
  screeningFieldId,
  type ScreeningAnswerError,
} from '@/components/public/ScreeningQuestionsFields';
import { Button, buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { LightDialogContent, LightDialogRoot } from '@/components/ui/light-dialog';
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
import {
  BTN_PRIMARY,
  BTN_RESET,
  BTN_SECONDARY,
  FORM_ERROR,
  FORM_FIELD,
  FORM_INPUT,
  FORM_LABEL_TEXT,
  FORM_SELECT,
  H2_EXTENDED,
} from '@/components/dashboard/panel-styles';

/**
 * ApplyModal — modal „Aplikuj teraz” (szybka aplikacja) wg makiety 03-job-detail.
 *
 * Renderuje własny wyzwalacz (przycisk główny w kolorze marki lub outline) i modal na Radix Dialog:
 * telefon (kod kraju + numer), dostępność, wiadomość (licznik 0/500), zgoda RODO oraz
 * „Wyślij aplikację”. Walidacja kliencka blokuje wysyłkę bez telefonu i zgody; przycisk
 * jest zablokowany w trakcie wysyłki (Invariant #11).
 *
 * Zapis realny: idempotentna Server Action `applyToJob` (Invariant #4) woła RPC `apply_to_job`,
 * które tworzy aplikację + kolejkuje e-mail do pracodawcy w jego języku (Invariant #1).
 * Sukces (potwierdzenie + zamknięcie) pokazujemy DOPIERO po `res.ok`. Błędy z warstwy domenowej
 * mapujemy na komunikat i18n (bez technikaliów — Invariant #8): brak logowania → link do logowania.
 *
 * Gość (#303, #98): gdy odczyt sesji strony (`PublicSavedJobsProvider`) mówi „anonymous”, modal
 * pokazuje jednorazową aplikację bez konta (`GuestApplyForm`, potwierdzenie e-mailem), a pod nią
 * wybór „załóż profil / zaloguj się” z bezpiecznym powrotem na tę ofertę (`?next=`).
 * Poza providerem albo gdy sesja wygaśnie w trakcie, zostaje dotychczasowy link po wysłaniu.
 *
 * Błąd sieci (#360): wyjątek z wywołania akcji (utrata połączenia, 413/5xx przed akcją) nie
 * zostawia przycisku w stanie „Wysyłanie…” — dane zostają, pojawia się komunikat, a ponowienie
 * wysyła TEN SAM klucz idempotencji (trzymany w `useRef` na czas otwartego modalu), więc
 * żądanie, które mimo błędu doszło do serwera, nie tworzy drugiej aplikacji (Invariant #4).
 * Ponowna aplikacja na tę samą ofertę (#361) daje „Już aplikowałeś…” z linkiem do historii.
 *
 * Oferta demonstracyjna (#297, `demo`): zamiast formularza modal mówi, że oferta i firma są
 * fikcyjne i nie można na nią aplikować — nikt nie wypełnia danych na próżno.
 *
 * Pytania screeningowe (#101): odpowiedzi idą w tym samym wywołaniu co aplikacja (jedna
 * transakcja w bazie). Brak odpowiedzi na pytanie wymagane blokuje wysyłkę przy pytaniu;
 * ten sam błąd z bazy (`questionId`) też trafia do pytania.
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

const AVAILABILITY = APPLY_AVAILABILITY_OPTIONS;
type Availability = ApplyAvailabilityOption;
const AVAILABILITY_TO_DB = APPLY_AVAILABILITY_TO_DB;

/** Rodzaj błędu formularza (mapowany na komunikat i18n, bez technikaliów). */
type FormError =
  | 'generic'
  | 'network'
  | 'already'
  | 'login'
  | 'candidateOnly'
  | 'rateLimited'
  | 'jobNotActive'
  | 'demo';
type PhoneError = 'required' | 'invalid';

export interface ApplyModalProps {
  jobId: string;
  companyName: string;
  triggerLabel: string;
  triggerHint?: string;
  triggerVariant?: 'default' | 'outline';
  triggerClassName?: string;
  triggerSize?: 'default' | 'lg' | 'passport';
  /** Oferta z zestawu demonstracyjnego — modal pokazuje komunikat zamiast formularza. */
  demo?: boolean;
  /** Pytania screeningowe oferty (#101); brak = formularz bez pytań. */
  screeningQuestions?: ScreeningQuestion[];
  /** Język treści oferty — tekst pytania, gdy brak tłumaczenia w języku strony. */
  contentLocale?: string;
}

export function ApplyModal({
  jobId,
  companyName,
  triggerLabel,
  triggerHint,
  triggerVariant = 'default',
  triggerClassName,
  triggerSize = 'lg',
  demo = false,
  screeningQuestions = [],
  contentLocale,
}: ApplyModalProps): React.JSX.Element {
  const t = useTranslations('apply');
  const tCommon = useTranslations('common');
  const tErrors = useTranslations('errors');
  const tGuest = useTranslations('guestApply');
  const viewer = usePublicViewerStatus();
  const isGuest = viewer === 'anonymous';
  // Pełna ścieżka z prefiksem języka — po zalogowaniu wracamy na tę ofertę.
  const pathname = usePathname();

  const [open, setOpen] = React.useState(false);
  const [dial, setDial] = React.useState<PhoneCountry>('PL');
  const [phone, setPhone] = React.useState('');
  const [availability, setAvailability] = React.useState<Availability>('immediate');
  const [message, setMessage] = React.useState('');
  const [consent, setConsent] = React.useState(false);
  const [answers, setAnswers] = React.useState<Record<string, ScreeningAnswerValue>>({});
  const [answerErrors, setAnswerErrors] = React.useState<Record<string, ScreeningAnswerError>>({});
  const [submitting, setSubmitting] = React.useState(false);
  const [errors, setErrors] = React.useState<{ phone?: PhoneError; message?: 'sensitiveId'; consent?: boolean }>({});
  const [formError, setFormError] = React.useState<FormError | null>(null);
  const [sent, setSent] = React.useState(false);
  // #393: formularz renderuje się w transition po pierwszej ramce dialogu, żeby tap „Aplikuj”
  // malował od razu ramkę z tytułem i przyciskiem zamknięcia (INP).
  const [formReady, setFormReady] = React.useState(false);
  const phoneRef = React.useRef<HTMLInputElement>(null);
  const messageRef = React.useRef<HTMLTextAreaElement>(null);
  const consentRef = React.useRef<HTMLButtonElement>(null);
  const formErrorRef = React.useRef<HTMLDivElement>(null);
  // Jeden klucz na otwarcie modalu: ponowienie po błędzie = ta sama próba (Invariant #4).
  const idempotencyKeyRef = React.useRef<string | null>(null);

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
    setAnswers({});
    setAnswerErrors({});
    setErrors({});
    setFormError(null);
    setSubmitting(false);
    idempotencyKeyRef.current = null;
  };

  const handleOpenChange = (next: boolean) => {
    if (next) {
      reset();
      setFormReady(false);
      // Lejek ofert (#99): rozpoczęcie aplikowania, raz na wyświetlenie oferty.
      if (!demo) reportApplyStarted(jobId);
    }
    setOpen(next);
  };

  React.useEffect(() => {
    if (open) React.startTransition(() => setFormReady(true));
  }, [open]);

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
    const missing = screeningQuestions.filter(
      (question) => question.required && isScreeningAnswerMissing(answers[question.id]),
    );
    setErrors(nextErrors);
    setAnswerErrors(Object.fromEntries(missing.map((question) => [question.id, true as const])));
    if (nextErrors.phone || missing.length > 0 || nextErrors.consent) {
      // Fokus + przewinięcie do pierwszego błędnego pola w kolejności formularza (Invariant #11).
      const firstInvalid = nextErrors.phone
        ? phoneRef.current
        : missing[0]
          ? document.getElementById(screeningFieldId(missing[0].id))
          : consentRef.current;
      firstInvalid?.focus();
      firstInvalid?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    // Tylko odpowiedzi na pytania tej oferty, bez pustych wartości (baza liczy je jak brak).
    const answerPayload: Record<string, ScreeningAnswerValue> = {};
    for (const question of screeningQuestions) {
      const value = answers[question.id];
      if (value === undefined || isScreeningAnswerMissing(value)) continue;
      answerPayload[question.id] = typeof value === 'string' ? value.trim() : value;
    }

    setFormError(null);
    setSubmitting(true);

    const trimmedMessage = message.trim();
    idempotencyKeyRef.current ??= crypto.randomUUID();

    let res: Awaited<ReturnType<typeof applyToJob>>;
    try {
      res = await applyToJob({
        jobId,
        phone: phone.trim(),
        phoneCountry: dial,
        availability: AVAILABILITY_TO_DB[availability],
        message: trimmedMessage.length > 0 ? trimmedMessage : undefined,
        agreeTerms: true,
        idempotencyKey: idempotencyKeyRef.current,
        ...(Object.keys(answerPayload).length > 0 ? { answers: answerPayload } : {}),
      });
    } catch {
      // Żądanie nie wróciło (sieć/timeout/5xx przed akcją). Dane formularza zostają.
      setSubmitting(false);
      setFormError('network');
      return;
    }

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
    } else if (res.reason === 'sensitiveId' && res.field === 'message') {
      // #495: numer NISS/BIS lub dokumentu w wiadomości — błąd przy polu, dane zostają.
      setErrors({ message: 'sensitiveId' });
      messageRef.current?.focus();
      messageRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } else if (res.reason === 'sensitiveId' && res.questionId) {
      const questionId = res.questionId;
      setAnswerErrors({ [questionId]: 'sensitiveId' });
      const field = document.getElementById(screeningFieldId(questionId));
      field?.focus();
      field?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } else if (res.error === 'SCREENING_ANSWER_REQUIRED' && res.questionId) {
      // Baza odrzuciła brak odpowiedzi na pytanie wymagane — błąd przy tym pytaniu.
      const questionId = res.questionId;
      setAnswerErrors({ [questionId]: true });
      const field = document.getElementById(screeningFieldId(questionId));
      field?.focus();
      field?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } else if (res.error === 'DEMO_UNAVAILABLE') {
      setFormError('demo');
    } else if (res.error === 'UNAUTHENTICATED') {
      setFormError('login');
    } else if (res.error === 'PERMISSION_DENIED') {
      // Zalogowany pracodawca/admin — link logowania nie ma sensu (#361).
      setFormError('candidateOnly');
    } else if (res.error === 'APPLICATION_ALREADY_EXISTS') {
      setFormError('already');
    } else if (res.error === 'RATE_LIMITED') {
      setFormError('rateLimited');
    } else if (res.error === 'JOB_NOT_ACTIVE') {
      setFormError('jobNotActive');
    } else {
      setFormError('generic');
    }
  };

  return (
    <>
      <LightDialogRoot open={open} onOpenChange={handleOpenChange}>
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

        <LightDialogContent
          open={open}
          overlayClassName="fixed inset-0 z-50 bg-foreground/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-[22px] border border-border bg-card p-7 shadow-lg max-[600px]:rounded-[18px] max-[600px]:p-5 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
        >
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className={H2_EXTENDED}>
                {demo ? t('demoJobTitle') : t('title')}
              </Dialog.Title>
              <Dialog.Description className="mt-1.5 text-sm leading-[1.6] text-muted-foreground">
                {demo ? t('demoJobBody') : isGuest ? tGuest('subtitle') : t('subtitle')}
              </Dialog.Description>
            </div>
            <Dialog.Close
              aria-label={t('close')}
              className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), '-mr-2 -mt-2 h-11 w-11 shrink-0 rounded-[10px]')}
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </Dialog.Close>
          </div>

          {demo ? null : viewer === 'loading' ? (
            <p role="status" className="py-6 text-center text-sm text-muted-foreground">
              {tCommon('loading')}
            </p>
          ) : isGuest ? (
            <div className="space-y-5">
            {formReady ? (
              <GuestApplyForm
                jobId={jobId}
                companyName={companyName}
                screeningQuestions={screeningQuestions}
                contentLocale={contentLocale}
              />
            ) : null}
            <p className="flex items-center gap-3 text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">
              {tGuest('orAccount')}
            </p>
            <div className="space-y-3" data-testid="apply-guest">
              <Link
                href={registerHref(pathname)}
                className={cn(BTN_PRIMARY, 'w-full')}
              >
                <UserPlus className="h-4 w-4 shrink-0" aria-hidden="true" />
                {t('guestRegister')}
              </Link>
              <Link
                href={loginHref(pathname)}
                className={cn(BTN_SECONDARY, 'w-full')}
              >
                <LogIn className="h-4 w-4 shrink-0" aria-hidden="true" />
                {t('guestLogin')}
              </Link>
              <p className="text-center text-[13px] text-muted-foreground">{t('guestReturn')}</p>
            </div>
            </div>
          ) : (
            <>
            <div className="mb-5 flex items-start gap-2 rounded-[8px] bg-success/10 px-3 py-2.5 text-[13px] text-success-text">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{t('profileNote')}</span>
            </div>

            {formReady ? (
              <form className="flex min-w-0 flex-col gap-5" onSubmit={handleSubmit} noValidate>
                <div className={FORM_FIELD}>
                  <Label htmlFor="apply-phone" className={FORM_LABEL_TEXT}>
                    {t('phone')} <span className="text-error" aria-hidden="true">*</span>
                  </Label>
                  <div className="flex gap-2">
                    <Select value={dial} onValueChange={(value) => setDial(value as PhoneCountry)}>
                      <SelectTrigger aria-label={t('dialCode')} className={cn(FORM_SELECT, 'w-28 shrink-0')}>
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
                      className={cn(FORM_INPUT, 'flex-1', errors.phone ? 'border-error' : undefined)}
                    />
                  </div>
                  {errors.phone ? (
                    <p id="apply-phone-error" className={FORM_ERROR}>
                      {errors.phone === 'invalid' ? t('phoneInvalid') : t('phoneRequired')}
                    </p>
                  ) : null}
                </div>

                <div className={FORM_FIELD}>
                  <Label htmlFor="apply-availability" className={FORM_LABEL_TEXT}>
                    {t('availability')} <span className="text-error" aria-hidden="true">*</span>
                  </Label>
                  <Select
                    value={availability}
                    onValueChange={(value) => setAvailability(value as Availability)}
                  >
                    <SelectTrigger id="apply-availability" aria-label={t('availability')} className={FORM_SELECT}>
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

                <div className={FORM_FIELD}>
                  <Label htmlFor="apply-message" className={FORM_LABEL_TEXT}>{t('message')}</Label>
                  <Textarea
                    ref={messageRef}
                    id="apply-message"
                    value={message}
                    onChange={(event) => {
                      setMessage(event.target.value.slice(0, MESSAGE_MAX));
                      if (errors.message) setErrors((current) => ({ ...current, message: undefined }));
                    }}
                    placeholder={t('messagePlaceholder')}
                    maxLength={MESSAGE_MAX}
                    rows={4}
                    aria-invalid={errors.message ? true : undefined}
                    aria-describedby={errors.message ? 'apply-message-error apply-message-hint' : 'apply-message-hint'}
                    className={cn(FORM_INPUT, errors.message ? 'border-error' : undefined)}
                  />
                  <p id="apply-message-hint" className="text-xs leading-[1.5] text-muted-foreground">
                    {t('sensitiveIdHint')}
                  </p>
                  {errors.message ? (
                    <p id="apply-message-error" className={FORM_ERROR}>
                      {t('sensitiveIdNotAllowed')}
                    </p>
                  ) : null}
                  <p className="text-right text-xs tabular-nums text-muted-foreground">
                    {message.length} / {MESSAGE_MAX}
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
                      const next = { ...current };
                      if (value === undefined) delete next[questionId];
                      else next[questionId] = value;
                      return next;
                    });
                    if (answerErrors[questionId] && !isScreeningAnswerMissing(value)) {
                      setAnswerErrors((current) => {
                        const next = { ...current };
                        delete next[questionId];
                        return next;
                      });
                    }
                  }}
                />

                <div className="flex items-start gap-[9px]">
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
                    className="cursor-pointer text-[13px] font-normal leading-[1.5] text-foreground"
                  >
                    {t.rich('privacyNoticeAck', {
                      privacy: (chunks) => (
                        <LegalDocLink href="/polityka-prywatnosci" newTabHint={t('opensInNewTab')}>
                          {chunks}
                        </LegalDocLink>
                      ),
                    })}
                  </Label>
                </div>
                {errors.consent ? (
                  <p id="apply-consent-error" className={cn(FORM_ERROR, '-mt-3')}>
                    {t('privacyNoticeRequired')}
                  </p>
                ) : null}

                {formError ? (
                  <div
                    ref={formErrorRef}
                    role="alert"
                    tabIndex={-1}
                    className="rounded-[16px] border border-error/30 bg-error/5 px-5 py-4 text-[13px] text-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {formError === 'login' ? (
                      <Link href={loginHref(pathname)} className="font-medium underline">
                        {t('loginRequired')}
                      </Link>
                    ) : formError === 'already' ? (
                      <>
                        {t('alreadyApplied')}{' '}
                        <Link href="/candidate/aplikacje" className="font-medium underline">
                          {t('viewApplications')}
                        </Link>
                      </>
                    ) : formError === 'candidateOnly' ? (
                      t('candidateOnly')
                    ) : formError === 'rateLimited' ? (
                      tErrors('rateLimited')
                    ) : formError === 'jobNotActive' ? (
                      tErrors('jobNotActive')
                    ) : formError === 'network' ? (
                      t('errorNetwork')
                    ) : formError === 'demo' ? (
                      t('demoUnavailable')
                    ) : (
                      t('errorGeneric')
                    )}
                  </div>
                ) : null}

                <Button type="submit" className={cn(BTN_PRIMARY, BTN_RESET, 'w-full')} disabled={submitting}>
                  <Lock className="h-4 w-4" aria-hidden="true" />
                  {submitting ? t('submitting') : t('submit')}
                </Button>

                <p className="text-center text-xs leading-[1.6] text-muted-foreground">
                  {t('sentTo', { company: companyName })}
                </p>
              </form>
            ) : null}
            </>
          )}
        </LightDialogContent>
      </LightDialogRoot>

      {sent ? (
        <div className="fixed bottom-4 right-4 z-[60] w-[calc(100vw-2rem)] max-w-sm">
          <Toast message={t('success')} tone="success" onClose={() => setSent(false)} />
        </div>
      ) : null}
    </>
  );
}

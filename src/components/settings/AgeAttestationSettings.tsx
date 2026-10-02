'use client';

import { useHydrated } from '@/components/forms/use-hydrated';
import { NoScriptFormNotice } from '@/components/forms/NoScriptFormNotice';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';

import { AgeDeclarationField } from '@/components/auth/AgeDeclarationField';
import { BTN_PRIMARY, BTN_RESET, PAPER } from '@/components/dashboard/panel-styles';
import { Button } from '@/components/ui/button';
import { attestCandidateAgeAction } from '@/lib/actions/age-attestation';
import type { AgeAttestationState } from '@/lib/data/age-policy';
import { CANDIDATE_ADULT_AGE, candidateAgeBandsFor } from '@/lib/age-policy/constants';
import { setKnownMinorDevice } from '@/lib/job-funnel/client';
import { useReportConfirmedAge } from '@/components/settings/age-status-context';
import { cn } from '@/lib/utils';

/**
 * AgeAttestationSettings — potwierdzenie przedziału wieku w ustawieniach kandydata (#492, #576).
 *
 * Dla konta sprzed polityki wieku albo po podniesieniu progu: bez ważnej deklaracji baza
 * odrzuca aplikowanie i włączenie widoczności profilu (0126). Zbieramy tylko przedział
 * (16–17 albo 18+) — bez daty urodzenia. Konto 16–17 widzi, że profil nie jest widoczny dla
 * firm, i po ukończeniu 18 lat potwierdza przedział 18+. Stan po zapisie pochodzi z serwera;
 * jedno żądanie naraz, błąd przy polu i `role="alert"`, sukces `role="status"` (Invariant #11).
 * Potwierdzony przedział trafia też do `AgeStatusProvider` (#828) — sekcja widoczności
 * odblokowuje się bez przeładowania; nieudany zapis niczego nie zgłasza.
 */
export function AgeAttestationSettings({
  initial,
  recruitmentEnabled = false,
}: {
  initial: AgeAttestationState;
  /** #1213: tryb z serwera; domyślnie ogłoszeniowy — teksty bez aplikowania i widoczności profilu. */
  recruitmentEnabled?: boolean;
}): React.JSX.Element {
  const hydrated = useHydrated();
  const t = useTranslations('ageAttestation');
  const v = (key: string): string => (recruitmentEnabled ? key : `${key}Listing`);
  const tAuth = useTranslations('auth');
  const [meets, setMeets] = React.useState(initial.meetsPolicy);
  const [adult, setAdult] = React.useState(initial.isAdult);
  const [band, setBand] = React.useState<number | null>(null);
  const [fieldError, setFieldError] = React.useState<string | null>(null);
  const [error, setError] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const fieldRef = React.useRef<HTMLInputElement>(null);
  const reportConfirmedAge = useReportConfirmedAge();
  // Konto 16–17 potwierdza tylko przejście na 18+ (niższy przedział już ma).
  const minorOnly = meets && !adult;
  const bands = minorOnly ? [CANDIDATE_ADULT_AGE] : candidateAgeBandsFor(initial.requiredMinAge);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (pending) return;
    setError(false);
    setSaved(false);
    if (band === null) {
      setFieldError(tAuth('error.ageConfirmRequired'));
      fieldRef.current?.focus();
      return;
    }
    setFieldError(null);
    setPending(true);
    try {
      const result = await attestCandidateAgeAction({ confirmed: true, minAge: band });
      if (result.ok && result.meetsPolicy) {
        const isAdult = band >= CANDIDATE_ADULT_AGE;
        setMeets(true);
        setAdult(isAdult);
        setBand(null);
        setKnownMinorDevice(!isAdult);
        reportConfirmedAge(isAdult);
        setSaved(true);
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  };

  return (
    <section aria-labelledby="age-attestation-title" className={PAPER}>
      <h2
        id="age-attestation-title"
        className="text-[23px] font-bold leading-[1.3] tracking-[-0.025em] text-foreground"
      >
        {t('sectionTitle')}
      </h2>
      <p className="mt-1 text-[15px] leading-[1.7] text-muted-foreground">
        {t(v('sectionDescription'), { age: initial.requiredMinAge, adultAge: CANDIDATE_ADULT_AGE })}
      </p>

      <p className="mt-4 text-sm font-medium text-foreground" data-testid="age-attestation-state">
        {!meets
          ? t(v('stateMissing'))
          : adult
            ? t('stateAdult', { age: CANDIDATE_ADULT_AGE })
            : t(v('stateMinor'), { adultAge: CANDIDATE_ADULT_AGE })}
      </p>

      {meets && adult ? null : (
        <form method="post" onSubmit={(event) => void submit(event)} noValidate className="mt-4 space-y-4">
          <NoScriptFormNotice />
          <AgeDeclarationField
            ref={fieldRef}
            id="age-attestation-confirm"
            minAge={bands[0] ?? initial.requiredMinAge}
            value={band}
            onChange={(value) => {
              setBand(value);
              setFieldError(null);
            }}
            error={fieldError}
            disabled={pending}
          />
          <Button type="submit" className={cn(BTN_PRIMARY, BTN_RESET)} disabled={pending || !hydrated} aria-busy={pending || undefined}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {pending ? t('saving') : t('submit')}
          </Button>
        </form>
      )}

      <div aria-live="polite">
        {error ? (
          <div
            role="alert"
            className="mt-4 flex items-start gap-3 rounded-md border border-error/30 bg-error/10 p-3 text-sm text-error-text"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p>{t('saveError')}</p>
          </div>
        ) : null}
        {saved ? (
          <p
            role="status"
            className="mt-4 flex items-start gap-3 rounded-md border border-success/30 bg-success/10 p-3 text-sm text-success-text"
          >
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {t('saved')}
          </p>
        ) : null}
      </div>
    </section>
  );
}

'use client';

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
import { cn } from '@/lib/utils';

/**
 * AgeAttestationSettings — potwierdzenie przedziału wieku w ustawieniach kandydata (#492, #576).
 *
 * Dla konta sprzed polityki wieku albo po podniesieniu progu: bez ważnej deklaracji baza
 * odrzuca aplikowanie i włączenie widoczności profilu (0126). Zbieramy tylko przedział
 * (16–17 albo 18+) — bez daty urodzenia. Konto 16–17 widzi, że profil nie jest widoczny dla
 * firm, i po ukończeniu 18 lat potwierdza przedział 18+. Stan po zapisie pochodzi z serwera;
 * jedno żądanie naraz, błąd przy polu i `role="alert"`, sukces `role="status"` (Invariant #11).
 */
export function AgeAttestationSettings({ initial }: { initial: AgeAttestationState }): React.JSX.Element {
  const t = useTranslations('ageAttestation');
  const tAuth = useTranslations('auth');
  const [meets, setMeets] = React.useState(initial.meetsPolicy);
  const [adult, setAdult] = React.useState(initial.isAdult);
  const [band, setBand] = React.useState<number | null>(null);
  const [fieldError, setFieldError] = React.useState<string | null>(null);
  const [error, setError] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const fieldRef = React.useRef<HTMLInputElement>(null);
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
        {t('sectionDescription', { age: initial.requiredMinAge, adultAge: CANDIDATE_ADULT_AGE })}
      </p>

      <p className="mt-4 text-sm font-medium text-foreground" data-testid="age-attestation-state">
        {!meets
          ? t('stateMissing')
          : adult
            ? t('stateAdult', { age: CANDIDATE_ADULT_AGE })
            : t('stateMinor', { adultAge: CANDIDATE_ADULT_AGE })}
      </p>

      {meets && adult ? null : (
        <form onSubmit={(event) => void submit(event)} noValidate className="mt-4 space-y-4">
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
          <Button type="submit" className={cn(BTN_PRIMARY, BTN_RESET)} disabled={pending} aria-busy={pending || undefined}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {pending ? t('saving') : t('submit')}
          </Button>
        </form>
      )}

      <div aria-live="polite">
        {error ? (
          <div
            role="alert"
            className="mt-4 flex items-start gap-3 rounded-md border border-error/30 bg-error/10 p-3 text-sm text-error"
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

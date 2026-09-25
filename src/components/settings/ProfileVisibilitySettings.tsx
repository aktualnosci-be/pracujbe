'use client';

import * as React from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { AlertCircle, CheckCircle2, Eye, Loader2 } from 'lucide-react';

import { PAPER } from '@/components/dashboard/panel-styles';
import { Link } from '@/i18n/navigation';
import { setProfileVisibilityAction } from '@/lib/actions/profile-visibility';
import type { ProfileVisibility } from '@/lib/data/profile-visibility';
import { cn } from '@/lib/utils';

/**
 * ProfileVisibilitySettings — świadome włączenie/wyłączenie widoczności profilu dla
 * zweryfikowanych firm (#494). Domyślnie wyłączone (baza, 0011/0029).
 *
 * Przed przełącznikiem: kto widzi profil, jakie pola, czego firma nie zobaczy i co zmienia
 * wyłączenie. Przełącznik (`role="switch"`) pokazuje wyłącznie stan potwierdzony przez
 * serwer: bez optymistycznej zmiany, po błędzie zostaje poprzednia wartość z komunikatem
 * `role="alert"` (Invariant #11: jedno żądanie naraz, `aria-busy`). Włączenie wymaga
 * ukończonego profilu (sprawdza też RPC); wyłączenie jest dostępne zawsze.
 *
 * #576 (LAUNCH-1): włączenie tylko dla konta z potwierdzonym przedziałem 18+. Konto 16–17
 * (`adult === false`) widzi wyłączony przełącznik z wyjaśnieniem; baza odrzuca włączenie
 * niezależnie od UI (`AGE_ADULT_REQUIRED`). `adult` nieznane (błąd odczytu) = bez blokady w UI.
 */
export function ProfileVisibilitySettings({
  initial,
  adult,
}: {
  initial: ProfileVisibility;
  adult?: boolean;
}): React.JSX.Element {
  const t = useTranslations('profileVisibility');
  const format = useFormatter();
  const [searchable, setSearchable] = React.useState(initial.searchable);
  const [changedAt, setChangedAt] = React.useState<string | null>(initial.changedAt);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<'save' | 'incomplete' | 'age' | 'adult' | null>(null);
  const [saved, setSaved] = React.useState<boolean | null>(null);

  const minor = adult === false;
  const canEnable = initial.completed && !minor;
  const disabled = pending || (!searchable && !canEnable);

  const toggle = async (): Promise<void> => {
    if (pending) return;
    const next = !searchable;
    setPending(true);
    setError(null);
    setSaved(null);
    try {
      const result = await setProfileVisibilityAction(next);
      if (!result.ok) {
        setError(
          result.error === 'ONBOARDING_INCOMPLETE'
            ? 'incomplete'
            : result.error === 'AGE_ATTESTATION_REQUIRED'
              ? 'age'
              : result.error === 'AGE_ADULT_REQUIRED'
                ? 'adult'
                : 'save',
        );
        return;
      }
      setSearchable(result.searchable);
      setChangedAt(result.changedAt);
      setSaved(result.searchable);
    } catch {
      setError('save');
    } finally {
      setPending(false);
    }
  };

  const date = changedAt ? new Date(changedAt) : null;
  const validDate = date && !Number.isNaN(date.getTime()) ? date : null;

  return (
    <section aria-labelledby="profile-visibility-title" className={PAPER}>
      <h2
        id="profile-visibility-title"
        className="flex items-center gap-2 text-[23px] font-bold leading-[1.3] tracking-[-0.025em] text-foreground"
      >
        <Eye className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
        {t('sectionTitle')}
      </h2>
      <p className="mt-1 text-[15px] leading-[1.7] text-muted-foreground">{t('sectionDescription')}</p>

      <dl id="profile-visibility-scope" className="mt-4 space-y-3 text-sm">
        <div>
          <dt className="font-medium text-foreground">{t('whoTitle')}</dt>
          <dd className="mt-0.5 text-muted-foreground">{t('whoText')}</dd>
        </div>
        <div>
          <dt className="font-medium text-foreground">{t('seenTitle')}</dt>
          <dd className="mt-0.5 text-muted-foreground">{t('seenText')}</dd>
        </div>
        <div>
          <dt className="font-medium text-foreground">{t('notSeenTitle')}</dt>
          <dd className="mt-0.5 text-muted-foreground">{t('notSeenText')}</dd>
        </div>
        <div>
          <dt className="font-medium text-foreground">{t('offTitle')}</dt>
          <dd className="mt-0.5 text-muted-foreground">{t('offText')}</dd>
        </div>
      </dl>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-4">
        <div className="min-w-0">
          <p id="profile-visibility-label" className="font-medium text-foreground">
            {t('toggleLabel')}
          </p>
          <p className="text-sm text-muted-foreground" data-testid="profile-visibility-state">
            {searchable ? t('stateOn') : t('stateOff')}
          </p>
          <p className="text-sm text-muted-foreground">
            {validDate
              ? t('changedAt', {
                  date: format.dateTime(validDate, { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Brussels' }),
                })
              : t('neverChanged')}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={searchable}
          aria-labelledby="profile-visibility-label"
          aria-describedby="profile-visibility-scope"
          aria-busy={pending || undefined}
          disabled={disabled}
          onClick={() => void toggle()}
          className={cn(
            'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border-2 border-transparent transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            'disabled:cursor-not-allowed disabled:opacity-50',
            searchable ? 'bg-primary' : 'bg-muted-foreground',
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              'inline-flex h-6 w-6 items-center justify-center rounded-full bg-background shadow transition-transform',
              searchable ? 'translate-x-5' : 'translate-x-0',
            )}
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
          </span>
        </button>
      </div>

      {minor && !searchable ? (
        <p className="mt-3 text-sm text-foreground" data-testid="profile-visibility-adult-only">
          {t('requiresAdult')}
        </p>
      ) : null}

      {!initial.completed && !searchable ? (
        <p className="mt-3 text-sm text-foreground">
          {t('requiresComplete')}{' '}
          <Link href="/candidate/onboarding" className="font-medium text-primary underline underline-offset-4">
            {t('completeProfile')}
          </Link>
        </p>
      ) : null}

      <div aria-live="polite">
        {pending ? <p className="sr-only">{t('saving')}</p> : null}
        {error ? (
          <div
            role="alert"
            className="mt-4 flex items-start gap-3 rounded-md border border-error/30 bg-error/10 p-3 text-sm text-error"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p>
              {error === 'incomplete'
                ? t('requiresComplete')
                : error === 'age'
                  ? t('requiresAge')
                  : error === 'adult'
                    ? t('requiresAdult')
                    : t('saveError')}
            </p>
          </div>
        ) : null}
        {saved !== null ? (
          <p
            role="status"
            className="mt-4 flex items-start gap-3 rounded-md border border-success/30 bg-success/10 p-3 text-sm text-success-text"
          >
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {saved ? t('savedOn') : t('savedOff')}
          </p>
        ) : null}
      </div>
    </section>
  );
}

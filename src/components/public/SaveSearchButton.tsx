'use client';

import * as React from 'react';
import { BellPlus, Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { saveSearchAction, type SaveSearchResult } from '@/lib/actions/saved-searches';
import { loginHref } from '@/lib/auth/next-path';
import { toUserMessageKey } from '@/lib/errors';
import type { SavedSearchFilters } from '@/lib/job-list-query';
import { cn } from '@/lib/utils';

/**
 * „Zapisz wyszukiwanie” na liście ofert (#100). Strona listy zostaje publiczna i nie czyta
 * sesji — akcja serwerowa sprawdza zalogowanie i rolę w bazie. Bez sesji: link logowania
 * z powrotem na tę samą listę. Invariant #11: przycisk zablokowany w trakcie zapisu, wynik
 * w regionie `status`/`alert`, powtórny zapis tych samych filtrów nie tworzy duplikatu.
 */
export interface SaveSearchButtonProps {
  locale: string;
  filters: SavedSearchFilters;
  /** Adres listy (`?…`) do ponownego otwarcia wyszukiwania. */
  query: string;
  /** Domyślna nazwa — etykiety aktywnych filtrów w języku strony. */
  name: string;
  /** Ścieżka listy (bez prefiksu języka) do powrotu po zalogowaniu. */
  loginNext: string;
  className?: string;
}

type Outcome = SaveSearchResult | { ok: false; error: 'NETWORK' } | null;

export function SaveSearchButton({
  locale,
  filters,
  query,
  name,
  loginNext,
  className,
}: SaveSearchButtonProps): React.JSX.Element {
  const t = useTranslations('savedSearches');
  const tRoot = useTranslations();
  const pageLocale = useLocale();
  const [pending, startTransition] = React.useTransition();
  const [outcome, setOutcome] = React.useState<Outcome>(null);

  const handleClick = () => {
    if (pending) return;
    setOutcome(null);
    startTransition(async () => {
      try {
        setOutcome(await saveSearchAction({ name: name || t('defaultName'), locale, filters, query }));
      } catch {
        setOutcome({ ok: false, error: 'NETWORK' });
      }
    });
  };

  let message: React.ReactNode = null;
  if (outcome?.ok) {
    message = (
      <p role="status" className="text-sm text-foreground">
        {outcome.created ? t('saved') : t('alreadySaved')}{' '}
        <Link href="/candidate/wyszukiwania" className="font-semibold text-accent-dark underline">
          {t('manage')}
        </Link>
      </p>
    );
  } else if (outcome && !outcome.ok) {
    message =
      outcome.error === 'UNAUTHENTICATED' ? (
        <p role="alert" className="text-sm text-foreground">
          {t('loginRequired')}{' '}
          <Link href={loginHref(`/${pageLocale}${loginNext}`)} className="font-semibold text-accent-dark underline">
            {t('login')}
          </Link>
        </p>
      ) : (
        <p role="alert" className="text-sm text-error-text">
          {outcome.error === 'NETWORK' ? t('errorNetwork') : tRoot(toUserMessageKey(outcome.error))}
        </p>
      );
  }

  return (
    <div className={cn('flex flex-col gap-2 rounded-xl border border-border bg-soft p-3 sm:p-4', className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">{t('hint')}</p>
        <button
          type="button"
          onClick={handleClick}
          disabled={pending}
          aria-busy={pending}
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60"
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <BellPlus className="h-4 w-4" aria-hidden="true" />
          )}
          {pending ? t('saving') : t('save')}
        </button>
      </div>
      {message}
    </div>
  );
}

'use client';

import * as React from 'react';
import { Bookmark } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { toggleSavedJob } from '@/lib/actions/candidate';
import { cn } from '@/lib/utils';
import { Toast } from '@/components/ui/toast';

/**
 * SaveJobButton — przełącznik „zapisz ofertę" (ikona zakładki) w panelu kandydata.
 *
 * Optymistyczna zmiana stanu (Invariant #11: blokada w trakcie), realny zapis przez
 * Server Action `toggleSavedJob` (insert/delete w `saved_jobs` pod sesją, RLS). Po odpowiedzi
 * synchronizuje stan z serwerem (gdy zwrócony); przy błędzie cofa optymistyczną zmianę i
 * pokazuje komunikat z i18n (bez technikaliów — Invariant #8). aria-label z `jobs.save`/`jobs.saved`.
 */
export function SaveJobButton({
  jobId,
  initialSaved = false,
  className,
}: {
  jobId: string;
  initialSaved?: boolean;
  className?: string;
}): React.JSX.Element {
  const t = useTranslations('jobs');
  const te = useTranslations('errors');

  const [saved, setSaved] = React.useState(initialSaved);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState(false);

  const label = saved ? t('saved') : t('save');

  const handleClick = () => {
    if (pending) return;
    const next = !saved;
    setSaved(next); // optymistycznie
    setError(false);

    startTransition(async () => {
      try {
        const res = await toggleSavedJob(jobId, next);
        if (res.ok) {
          if (typeof res.saved === 'boolean') setSaved(res.saved);
          return;
        }
      } catch {
        // Błąd transportu akcji także musi cofnąć optymistyczny zapis.
      }
      setSaved(!next); // cofnięcie
      setError(true);
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        aria-label={label}
        aria-pressed={saved}
        title={label}
        className={cn(
          'inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl transition-colors hover:bg-soft disabled:opacity-50',
          saved ? 'text-accent' : 'text-muted-foreground hover:text-accent',
          className,
        )}
      >
        <Bookmark className={cn('h-4 w-4', saved && 'fill-current')} aria-hidden="true" />
      </button>

      {error ? (
        <div className="fixed bottom-4 right-4 z-[60] w-[calc(100vw-2rem)] max-w-sm">
          <Toast message={te('generic')} tone="error" onClose={() => setError(false)} />
        </div>
      ) : null}
    </>
  );
}

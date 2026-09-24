'use client';

import * as React from 'react';
import { Bookmark, BookmarkCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { loginHref } from '@/lib/auth/next-path';
import {
  getPublicSavedJobs,
  type PublicSavedState,
} from '@/lib/actions/public-saved-jobs';
import { toggleSavedJob } from '@/lib/actions/candidate';

type State = PublicSavedState | { status: 'loading' };
type Context = {
  state: State;
  pending: Set<string>;
  errors: Set<string>;
  reload: () => void;
  toggle: (id: string) => void;
};
const SavedContext = React.createContext<Context | null>(null);

export function PublicSavedJobsProvider({
  jobIds,
  children,
}: {
  jobIds: string[];
  children: React.ReactNode;
}) {
  // Stabilny klucz ogranicza odczyty przy renderze rodzica.
  const key = JSON.stringify([...new Set(jobIds)].sort());
  const [state, setState] = React.useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = React.useState(0);
  const [pending, setPending] = React.useState(new Set<string>());
  const [errors, setErrors] = React.useState(new Set<string>());
  const locks = React.useRef(new Set<string>());
  React.useEffect(() => {
    let active = true;
    setState({ status: 'loading' });
    getPublicSavedJobs(JSON.parse(key) as string[])
      .then((result) => {
        if (active) setState(result);
      })
      .catch(() => {
        if (active) setState({ status: 'error' });
      });
    return () => {
      active = false;
    };
  }, [key, attempt]);
  const toggle = async (id: string) => {
    if (state.status !== 'candidate' || locks.current.has(id)) return;
    locks.current.add(id);
    setPending(new Set(locks.current));
    setErrors((previous) => {
      const next = new Set(previous);
      next.delete(id);
      return next;
    });
    const wasSaved = state.savedIds.includes(id);
    const update = (saved: boolean) =>
      setState((previous) =>
        previous.status === 'candidate'
          ? {
              ...previous,
              savedIds: saved
                ? [...new Set([...previous.savedIds, id])]
                : previous.savedIds.filter((value) => value !== id),
            }
          : previous,
      );
    update(!wasSaved);
    try {
      const result = await toggleSavedJob(id, !wasSaved);
      if (!result.ok || typeof result.saved !== 'boolean')
        throw new Error('save');
      update(result.saved);
    } catch {
      update(wasSaved);
      setErrors((previous) => new Set([...previous, id]));
    } finally {
      locks.current.delete(id);
      setPending(new Set(locks.current));
    }
  };
  return (
    <SavedContext.Provider
      value={{
        state,
        pending,
        errors,
        toggle,
        reload: () => setAttempt((value) => value + 1),
      }}
    >
      {children}
    </SavedContext.Provider>
  );
}

/**
 * Stan sesji odwiedzającego z odczytu zapisanych ofert (jeden odczyt na stronę).
 * `null` poza providerem — wtedy komponent nie zna sesji i zachowuje się jak dotąd.
 */
export function usePublicViewerStatus(): State['status'] | null {
  return React.useContext(SavedContext)?.state.status ?? null;
}

export function PublicSaveJobButton({
  jobId,
  className,
  iconOnly = false,
  plain = false,
}: {
  jobId: string;
  className?: string;
  iconOnly?: boolean;
  /** Bez obramowania (karta-paszport) — tylko z `iconOnly`. */
  plain?: boolean;
}) {
  const context = React.useContext(SavedContext);
  const t = useTranslations('jobs');
  // Anonim wraca po zalogowaniu na bieżącą stronę (oferta lub lista).
  const pathname = usePathname();
  const status = context?.state.status ?? 'unavailable';
  const saved =
    context?.state.status === 'candidate' &&
    context.state.savedIds.includes(jobId);
  const label =
    status === 'anonymous'
      ? t('saveLogin')
      : status === 'unavailable'
        ? t('saveUnavailable')
        : status === 'loading'
          ? t('saveLoading')
          : status === 'error'
            ? t('saveRetry')
            : saved
              ? t('saved')
              : t('save');
  // Wariant `plain` (karta-paszport) = `.p-save` z prototypu (klasa `.pp-save` w globals.css):
  // sama zakładka 30 × 30 px bez obramowania, zapisana na jasnoczerwonym tle (aria-pressed).
  const flat = iconOnly && plain;
  const style = flat
    ? 'pp-save focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60'
    : cn(
        'relative z-10 inline-flex min-h-12 min-w-12 shrink-0 items-center justify-center gap-2 rounded-xl border border-border bg-background px-3 text-sm transition-colors hover:bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60',
        saved ? 'text-accent' : 'text-muted-foreground',
      );
  const Icon = saved ? BookmarkCheck : Bookmark;
  const content = (
    <>
      <Icon className={flat ? undefined : 'h-5 w-5'} strokeWidth={flat ? 1.5 : undefined} aria-hidden="true" />
      {!iconOnly && label}
    </>
  );
  if (status === 'anonymous')
    return (
      <Link
        href={loginHref(pathname)}
        className={cn(style, className)}
        aria-label={label}
        title={label}
      >
        {content}
      </Link>
    );
  return (
    <span className={cn('relative z-10 inline-flex flex-col', className)}>
      <button
        type="button"
        className={flat ? style : cn(style, 'w-full')}
        aria-label={label}
        title={label}
        aria-pressed={status === 'candidate' ? saved : undefined}
        disabled={
          status === 'loading' ||
          status === 'unavailable' ||
          context?.pending.has(jobId)
        }
        onClick={() =>
          status === 'error' ? context?.reload() : context?.toggle(jobId)
        }
      >
        {content}
      </button>
      {context?.errors.has(jobId) && (
        <span role="alert" className="block max-w-xs text-sm text-error">
          {t('saveFailed')}
        </span>
      )}
    </span>
  );
}

'use client';

import * as React from 'react';
import { MoreHorizontal, ExternalLink, XCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Link, useRouter } from '@/i18n/navigation';
import { withdrawApplication } from '@/lib/actions/candidate';
import { cn } from '@/lib/utils';
import { Toast } from '@/components/ui/toast';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

/**
 * ApplicationActions — menu wiersza aplikacji w panelu kandydata (makieta 04, przycisk „…").
 *
 * Lekki, kontrolowany dropdown (useState + zamykanie po kliknięciu poza / Escape — bez
 * dodatkowej zależności). Akcje:
 *   - „Zobacz ofertę" (gdy znany slug) → publiczna strona oferty (Link z prefiksem locale),
 *   - „Wycofaj aplikację" (dla statusów w toku) → Server Action `withdrawApplication`.
 * Zapis realny pod sesją (RLS + trigger dopuszczają dla właściciela tylko przejście do 'withdrawn').
 * Wycofanie jest nieodwracalne, więc najpierw pyta w `ConfirmDialog` (#328); anulowanie nie woła
 * akcji, fokus wraca do przycisku „…". Po sukcesie komunikat `role="status"` i odświeżenie trasy
 * (StatusPill zmieni się na „Wycofana"); błąd → Toast z i18n.
 */

/** Statusy, z których kandydat może jeszcze wycofać aplikację. */
const WITHDRAWABLE = new Set(['submitted', 'viewed', 'shortlisted', 'interview', 'offer_sent']);

export function ApplicationActions({
  applicationId,
  status,
  slug,
  jobTitle,
}: {
  applicationId: string;
  status: string;
  slug: string | null;
  /** Tytuł oferty do treści potwierdzenia (opcjonalny — bez niego tekst ogólny). */
  jobTitle?: string;
}): React.JSX.Element {
  const td = useTranslations('dashboard');
  const te = useTranslations('errors');
  const tc = useTranslations('common');

  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [withdrawn, setWithdrawn] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const router = useRouter();

  const canWithdraw = WITHDRAWABLE.has(status);

  // „…" jest zablokowany w trakcie zapisu, więc fokus wraca do niego po zakończeniu.
  React.useEffect(() => {
    if (withdrawn && !pending) triggerRef.current?.focus();
  }, [withdrawn, pending]);

  React.useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const askWithdraw = () => {
    setOpen(false);
    setConfirmOpen(true);
  };

  const handleWithdraw = () => {
    if (pending) return;
    setError(false);
    setWithdrawn(false);
    startTransition(async () => {
      try {
        const res = await withdrawApplication(applicationId);
        setConfirmOpen(false);
        if (res.ok) {
          setWithdrawn(true);
          router.refresh();
          return;
        }
        setError(true);
      } catch {
        setConfirmOpen(false);
        setError(true);
      }
    });
  };

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={pending}
        aria-label={td('rowActions')}
        aria-haspopup="menu"
        aria-expanded={open}
        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-soft hover:text-foreground disabled:opacity-50"
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-1 w-52 overflow-hidden rounded-lg border border-border bg-background py-1 shadow-lg"
        >
          {slug ? (
            <Link
              href={`/oferty-pracy/${slug}`}
              role="menuitem"
              className="flex items-center gap-2 px-3 py-2 text-sm text-foreground transition-colors hover:bg-soft"
              onClick={() => setOpen(false)}
            >
              <ExternalLink className="h-4 w-4 shrink-0" aria-hidden="true" />
              {td('actionView')}
            </Link>
          ) : null}

          {canWithdraw ? (
            <button
              type="button"
              role="menuitem"
              onClick={askWithdraw}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-error-text transition-colors hover:bg-error/10',
              )}
            >
              <XCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
              {td('withdrawApplication')}
            </button>
          ) : null}
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={td('withdrawConfirmTitle')}
        description={
          jobTitle
            ? td('withdrawConfirmDescriptionNamed', { title: jobTitle })
            : td('withdrawConfirmDescription')
        }
        confirmLabel={td('withdrawConfirm')}
        cancelLabel={tc('cancel')}
        onConfirm={handleWithdraw}
        pending={pending}
        getReturnFocus={() => triggerRef.current}
      />

      {error ? (
        <div className="fixed bottom-4 right-4 z-[60] w-[calc(100vw-2rem)] max-w-sm">
          <Toast message={te('generic')} tone="error" onClose={() => setError(false)} />
        </div>
      ) : null}

      {withdrawn ? (
        <div className="fixed bottom-4 right-4 z-[60] w-[calc(100vw-2rem)] max-w-sm">
          <Toast message={td('withdrawSuccess')} onClose={() => setWithdrawn(false)} />
        </div>
      ) : null}
    </div>
  );
}

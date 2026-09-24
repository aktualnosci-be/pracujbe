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
 * Lekki dropdown bez dodatkowej zależności, z pełnym wzorcem ARIA menu (#341): po otwarciu
 * fokus trafia na pierwszą pozycję, strzałki/Home/End przesuwają fokus, Escape zamyka i wraca
 * do „…", Tab zamyka. Etykieta przycisku zawiera tytuł oferty, cel dotykowy ≥ 44 px. Akcje:
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
  const menuRef = React.useRef<HTMLDivElement>(null);
  const menuId = React.useId();
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
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [open]);

  const menuItems = (): HTMLElement[] =>
    Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  // Po otwarciu fokus na pierwszej pozycji menu.
  React.useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);

  const closeMenu = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = menuItems();
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    const focusAt = (next: number) => items[(next + items.length) % items.length]?.focus();
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusAt(index + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusAt(index < 0 ? items.length - 1 : index - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusAt(0);
        break;
      case 'End':
        event.preventDefault();
        focusAt(items.length - 1);
        break;
      case 'Escape':
        event.preventDefault();
        closeMenu(true);
        break;
      case 'Tab':
        setOpen(false);
        break;
    }
  };

  const onTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
    }
  };

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
        onKeyDown={onTriggerKeyDown}
        disabled={pending}
        aria-label={jobTitle ? td('rowActionsFor', { title: jobTitle }) : td('rowActions')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-soft hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
      </button>

      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={jobTitle ? td('rowActionsFor', { title: jobTitle }) : td('rowActions')}
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 top-full z-20 mt-1 w-52 overflow-hidden rounded-lg border border-border bg-background py-1 shadow-lg"
        >
          {slug ? (
            <Link
              href={`/oferty-pracy/${slug}`}
              role="menuitem"
              tabIndex={-1}
              className="flex min-h-11 items-center gap-2 px-3 py-2 text-sm text-foreground transition-colors hover:bg-soft focus:bg-soft focus:outline-none"
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
              tabIndex={-1}
              onClick={askWithdraw}
              className={cn(
                'flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-sm text-error-text transition-colors hover:bg-error/10 focus:bg-error/10 focus:outline-none',
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

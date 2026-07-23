'use client';

import * as React from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useRouter } from '@/i18n/navigation';
import { transitionApplication } from '@/lib/actions/applications';
import { toUserMessageKey, type ErrorCode } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { Toast } from '@/components/ui/toast';

/**
 * ApplicationStatusMenu — menu zmiany statusu aplikacji (panel pracodawcy).
 *
 * Lekki, dostępny dropdown (bez nowych zależności): przycisk-wyzwalacz + lista dozwolonych
 * przejść. Wybór woła Server Action `transitionApplication` (RPC z allow-listą w DB — Invariant #8).
 * Allow-lista UI: viewed / shortlisted / interview / rejected / hired. Przycisk zablokowany
 * w trakcie zapisu (useTransition, Invariant #11); po sukcesie `router.refresh()` + toast,
 * przy błędzie toast z komunikatem i18n (bez technikaliów).
 */

const TARGET_STATUSES = ['viewed', 'shortlisted', 'interview', 'rejected', 'hired'] as const;
type TargetStatus = (typeof TARGET_STATUSES)[number];

const TOAST_MS = 4000;

export interface ApplicationStatusMenuProps {
  applicationId: string;
  /** Bieżący status aplikacji (podświetlony w menu, jeśli należy do allow-listy). */
  status: string;
  className?: string;
}

export function ApplicationStatusMenu({
  applicationId,
  status,
  className,
}: ApplicationStatusMenuProps): React.JSX.Element {
  const td = useTranslations('dashboard');
  const ts = useTranslations('status');
  const tRoot = useTranslations();

  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [toast, setToast] = React.useState<{ tone: 'success' | 'error'; message: string } | null>(
    null,
  );

  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const router = useRouter();

  // Zamknięcie po kliknięciu poza obszarem.
  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (containerRef.current && target && !containerRef.current.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  // Auto-zamknięcie toasta.
  React.useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const handleSelect = (target: TargetStatus) => {
    setOpen(false);
    if (pending) return;
    startTransition(async () => {
      try {
        const res = await transitionApplication(applicationId, target);
        if (res.ok) {
          setToast({ tone: 'success', message: td('statusChanged') });
          router.refresh();
        } else {
          setToast({ tone: 'error', message: tRoot(toUserMessageKey(res.error as ErrorCode)) });
        }
      } catch {
        setToast({ tone: 'error', message: tRoot(toUserMessageKey('INTERNAL')) });
      }
    });
  };

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={pending}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-soft hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
      >
        {td('colStatusEmp')}
        <ChevronDown className="size-3.5" aria-hidden="true" />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+0.25rem)] z-50 min-w-[10rem] overflow-hidden rounded-md border border-border bg-background p-1 shadow-md"
        >
          {TARGET_STATUSES.map((target) => {
            const isCurrent = target === status;
            return (
              <button
                key={target}
                type="button"
                role="menuitem"
                onClick={() => handleSelect(target)}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-soft"
              >
                <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
                  {isCurrent ? <Check className="size-4 text-primary" /> : null}
                </span>
                <span className="truncate">{ts(target)}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {toast ? (
        <div className="fixed bottom-4 right-4 z-[60] w-[calc(100vw-2rem)] max-w-sm">
          <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />
        </div>
      ) : null}
    </div>
  );
}

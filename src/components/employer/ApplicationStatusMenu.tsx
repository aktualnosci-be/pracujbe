'use client';

import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useRouter } from '@/i18n/navigation';
import { transitionApplication } from '@/lib/actions/applications';
import {
  CONFIRM_TARGET_STATUSES,
  menuTargetsFor,
  type MenuTargetStatus,
} from '@/lib/applications/transitions';
import { toUserMessageKey, type ErrorCode } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { toCamel } from '@/components/ui/status-pill';
import { Toast } from '@/components/ui/toast';
import { BTN_SMALL } from '@/components/dashboard/panel-styles';

/**
 * ApplicationStatusMenu — menu zmiany statusu aplikacji (panel pracodawcy).
 *
 * Lekki, dostępny dropdown (bez nowych zależności): przycisk-wyzwalacz + lista przejść.
 * Opcje pochodzą z macierzy `src/lib/applications/transitions.ts` (lustro `transition_application`
 * w DB, zgodność pilnowana testem) — menu pokazuje tylko przejścia, które RPC przyjmie (#306).
 * Stan końcowy (brak dozwolonych przejść) = brak menu, tylko informacja „Status końcowy".
 * `rejected`/`hired` wymagają potwierdzenia (skutek nieodwracalny). Przycisk zablokowany
 * w trakcie zapisu (useTransition, Invariant #11); po sukcesie `router.refresh()` + toast,
 * przy błędzie toast z komunikatem i18n (bez technikaliów — Invariant #8).
 *
 * Dostępna nazwa triggera zawiera kandydata, ofertę i bieżący status (#333), więc kilka menu
 * na jednej liście jest rozróżnialnych w czytniku ekranu.
 */

const TOAST_MS = 4000;

export interface ApplicationStatusMenuProps {
  applicationId: string;
  /** Bieżący status aplikacji (surowy, np. `offer_sent`). */
  status: string;
  /** Imię i nazwisko kandydata (lub etykieta zastępcza) — do dostępnej nazwy. */
  candidateName: string;
  /** Tytuł oferty — do dostępnej nazwy. */
  jobTitle: string;
  className?: string;
}

export function ApplicationStatusMenu({
  applicationId,
  status,
  candidateName,
  jobTitle,
  className,
}: ApplicationStatusMenuProps): React.JSX.Element {
  const td = useTranslations('dashboard');
  const ts = useTranslations('status');
  const tc = useTranslations('common');
  const tRoot = useTranslations();

  const [open, setOpen] = React.useState(false);
  const [confirmTarget, setConfirmTarget] = React.useState<MenuTargetStatus | null>(null);
  const [pending, startTransition] = React.useTransition();
  const [toast, setToast] = React.useState<{ tone: 'success' | 'error'; message: string } | null>(
    null,
  );

  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const confirmRef = React.useRef<HTMLButtonElement | null>(null);
  const restoreFocusAfterTransitionRef = React.useRef(false);
  const panelId = React.useId();
  const router = useRouter();

  const targets = menuTargetsFor(status);
  const labelParams = {
    name: candidateName,
    job: jobTitle || td('applicationUnknownJob'),
    status: ts(toCamel(status)),
  };

  const close = React.useCallback(() => {
    setOpen(false);
    setConfirmTarget(null);
  }, []);

  // Zamknięcie po kliknięciu poza obszarem.
  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (containerRef.current && target && !containerRef.current.contains(target)) {
        close();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, close]);

  // Auto-zamknięcie toasta.
  React.useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // Fokus na przycisk potwierdzenia po przejściu do kroku potwierdzenia.
  React.useEffect(() => {
    if (confirmTarget) confirmRef.current?.focus();
  }, [confirmTarget]);

  // Wybranie opcji odmontowuje panel, a trigger jest chwilowo disabled podczas zapisu.
  // Fokus wraca więc dopiero po zakończeniu transition, gdy kontrolka znów może go przyjąć.
  React.useEffect(() => {
    if (pending || !restoreFocusAfterTransitionRef.current) return;
    restoreFocusAfterTransitionRef.current = false;
    triggerRef.current?.focus();
  }, [pending]);

  if (targets.length === 0) {
    return (
      <p className={cn('text-sm text-muted-foreground', className)}>
        <span aria-hidden="true">{td('statusFinal')}</span>
        <span className="sr-only">{td('statusFinalLabel', labelParams)}</span>
      </p>
    );
  }

  const submit = (target: MenuTargetStatus) => {
    if (pending) return;
    restoreFocusAfterTransitionRef.current = true;
    close();
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

  const handleSelect = (target: MenuTargetStatus) => {
    if (pending) return;
    if (CONFIRM_TARGET_STATUSES.includes(target)) {
      setConfirmTarget(target);
      return;
    }
    submit(target);
  };

  return (
    <div
      ref={containerRef}
      className={cn('relative', className)}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          close();
          triggerRef.current?.focus();
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label={td('statusMenuTrigger', labelParams)}
        aria-haspopup="true"
        aria-controls={panelId}
        aria-expanded={open}
        disabled={pending}
        onClick={() => (open ? close() : setOpen(true))}
        className={cn(BTN_SMALL, 'border-border text-foreground hover:bg-soft')}
      >
        {td('colStatusEmp')}
        <ChevronDown className="size-3.5" aria-hidden="true" />
      </button>

      {open ? (
        <div
          id={panelId}
          className="absolute right-0 top-[calc(100%+0.25rem)] z-50 min-w-[12rem] max-w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-[14px] border border-border bg-card p-1 shadow-[0_5px_20px_hsl(var(--foreground)/0.07)]"
        >
          {confirmTarget ? (
            <div className="space-y-3 p-2" role="group" aria-label={td('statusMenuOptions', labelParams)}>
              <p className="text-sm text-foreground">
                {td('statusConfirmQuestion', { status: ts(toCamel(confirmTarget)) })}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  ref={confirmRef}
                  type="button"
                  onClick={() => submit(confirmTarget)}
                  className={cn(BTN_SMALL, 'border-primary bg-primary text-primary-foreground hover:bg-primary-dark')}
                >
                  {td('statusConfirmAction')}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmTarget(null)}
                  className={cn(BTN_SMALL, 'border-border text-foreground hover:bg-soft')}
                >
                  {tc('cancel')}
                </button>
              </div>
            </div>
          ) : (
            <ul aria-label={td('statusMenuOptions', labelParams)}>
              {targets.map((target) => (
                <li key={target}>
                  <button
                    type="button"
                    onClick={() => handleSelect(target)}
                    className="flex min-h-12 w-full items-center gap-2 rounded-[10px] px-2.5 py-2 text-left text-[13px] text-foreground transition-colors hover:bg-muted"
                  >
                    <span className="truncate">{ts(toCamel(target))}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
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

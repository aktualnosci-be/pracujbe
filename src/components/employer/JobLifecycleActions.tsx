'use client';

import * as React from 'react';
import { Archive, Pause, Play, RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useRouter } from '@/i18n/navigation';
import { setJobStatus, type JobLifecycleAction } from '@/lib/actions/jobs';
import { toUserMessageKey, type ErrorCode } from '@/lib/errors';
import { Button } from '@/components/ui/button';
import { Toast } from '@/components/ui/toast';

/**
 * JobLifecycleActions (P1-04) — zarządzanie cyklem życia opublikowanej oferty z listy ofert
 * pracodawcy: pauza / wznowienie / zamknięcie / ponowne otwarcie.
 *
 * Dostępne akcje wynikają ze STANU oferty i odpowiadają macierzy przejść w RPC `set_job_status`
 * (0056) — UI nie zgaduje: pokazuje tylko dozwolone przejścia, a DB i tak je egzekwuje (klient nie
 * zmienia statusu bezpośrednio — guard trigger). Przyciski blokowane w trakcie zapisu (useTransition),
 * błędy → toast z komunikatem i18n.
 */

const TOAST_MS = 4000;

export interface JobLifecycleActionsProps {
  jobId: string;
  /** Status efektywny: draft/active/paused/closed/expired (aktywna po terminie = expired, #72). */
  status: string;
  /**
   * Data ważności minęła (#72). Wstrzymana po terminie nie jest wznawiana (RPC odrzuca
   * `resume` — data nie znika po cichu); proponujemy ponowne otwarcie, które usuwa datę.
   */
  pastExpiry?: boolean;
}

/** Dozwolone przejścia per stan — odzwierciedla macierz z RPC (`set_job_status`, 0085). */
export function allowedActions(status: string, pastExpiry = false): JobLifecycleAction[] {
  switch (status) {
    case 'active':
      return ['pause', 'close'];
    case 'paused':
      return pastExpiry ? ['reopen', 'close'] : ['resume', 'close'];
    case 'closed':
    case 'expired':
      return ['reopen'];
    default:
      return []; // draft → publikacja przez kreator (publish_job)
  }
}

export function JobLifecycleActions({
  jobId,
  status,
  pastExpiry = false,
}: JobLifecycleActionsProps): React.JSX.Element | null {
  const t = useTranslations('dashboard');
  const tRoot = useTranslations();
  const router = useRouter();

  const [pending, startTransition] = React.useTransition();
  const [toast, setToast] = React.useState<{ tone: 'success' | 'error'; message: string } | null>(
    null,
  );

  React.useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const actions = allowedActions(status, pastExpiry);
  if (actions.length === 0) return null;

  const LABEL: Record<JobLifecycleAction, string> = {
    pause: t('jobPause'),
    resume: t('jobResume'),
    close: t('jobClose'),
    reopen: t('jobReopen'),
  };
  const ICON: Record<JobLifecycleAction, React.ReactNode> = {
    pause: <Pause className="size-4" aria-hidden="true" />,
    resume: <Play className="size-4" aria-hidden="true" />,
    close: <Archive className="size-4" aria-hidden="true" />,
    reopen: <RotateCcw className="size-4" aria-hidden="true" />,
  };

  const run = (action: JobLifecycleAction) => {
    if (pending) return;
    startTransition(async () => {
      try {
        const res = await setJobStatus(jobId, action);
        if (res.ok) {
          setToast({ tone: 'success', message: t('jobStatusUpdated') });
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
    <>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {actions.map((action) => (
          <Button
            key={action}
            type="button"
            size="sm"
            variant="outline"
            className="min-h-12 whitespace-normal rounded-xl text-center"
            disabled={pending}
            onClick={() => run(action)}
          >
            {ICON[action]}
            {LABEL[action]}
          </Button>
        ))}
      </div>

      {toast ? (
        <div className="fixed bottom-4 right-4 z-[60] w-[calc(100vw-2rem)] max-w-sm">
          <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />
        </div>
      ) : null}
    </>
  );
}

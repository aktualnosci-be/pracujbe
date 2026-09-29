'use client';

import * as React from 'react';
import { Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useRouter } from '@/i18n/navigation';
import { deleteJobDraft } from '@/lib/actions/jobs';
import { toUserMessageKey, type ErrorCode } from '@/lib/errors';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Toast } from '@/components/ui/toast';
import { BTN_SMALL } from '@/components/dashboard/panel-styles';
import { cn } from '@/lib/utils';

/**
 * „Usuń szkic” (#1099, EMP-04): szkic oferty można usunąć z listy ofert po potwierdzeniu.
 * Dialog jest nieodwracalnego potwierdzenia (`ConfirmDialog`, fokus na „Anuluj”), przycisk
 * zablokowany w trakcie zapisu (Invariant #11); błąd = komunikat z kodu, szkic zostaje.
 */

const TOAST_MS = 5000;

export interface DeleteJobDraftButtonProps {
  jobId: string;
  title: string;
}

export function DeleteJobDraftButton({ jobId, title }: DeleteJobDraftButtonProps): React.JSX.Element {
  const t = useTranslations('dashboard');
  const tRoot = useTranslations();
  const router = useRouter();
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(null), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [error]);

  const run = () => {
    if (pending) return;
    startTransition(async () => {
      try {
        const res = await deleteJobDraft(jobId);
        if (!res.ok) {
          setOpen(false);
          setError(tRoot(toUserMessageKey(res.error as ErrorCode)));
          return;
        }
        setOpen(false);
        router.refresh();
      } catch {
        setOpen(false);
        setError(tRoot(toUserMessageKey('INTERNAL')));
      }
    });
  };

  const displayTitle = title.trim() || t('deleteJobDraftUntitled');

  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        size="sm"
        variant="outline"
        className={cn(BTN_SMALL, 'h-auto border-border text-foreground hover:bg-soft')}
        disabled={pending}
        aria-label={t('deleteJobDraftLabel', { title: displayTitle })}
        onClick={() => setOpen(true)}
      >
        <Trash2 className="size-4" aria-hidden="true" />
        {t('deleteJobDraft')}
      </Button>

      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t('deleteJobDraftTitle')}
        description={t('deleteJobDraftDescription', { title: displayTitle })}
        confirmLabel={t('deleteJobDraftConfirm')}
        cancelLabel={t('deleteJobDraftCancel')}
        onConfirm={run}
        pending={pending}
        getReturnFocus={() => triggerRef.current}
      />

      {error ? (
        <div className="fixed bottom-4 right-4 z-[60] w-[calc(100vw-2rem)] max-w-sm">
          <Toast message={error} tone="error" onClose={() => setError(null)} />
        </div>
      ) : null}
    </>
  );
}

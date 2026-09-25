'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';

import { activateEmailCampaign, cancelEmailCampaign } from '@/lib/actions/admin-campaigns';
import { emailCampaignFocusKey } from '@/lib/admin/focus';
import { toUserMessageKey } from '@/lib/errors';
import { cn } from '@/lib/utils';
import {
  ADMIN_ACTION_TONE_CLASS,
  ADMIN_BUTTON_BASE,
  AdminConfirmDialog,
} from '@/components/admin/AdminConfirmDialog';
import { useAdminFeedback } from '@/components/admin/AdminFeedback';

/**
 * EmailCampaignActions — aktywacja i zatrzymanie rewizji kampanii e-mail (#45, panel admina).
 *
 * Każda decyzja wymaga potwierdzenia w dialogu (slug, rewizja, status). Status widziany przez
 * admina idzie do RPC (`p_expected_status`) — zmiana w międzyczasie = `STALE_STATE`.
 * Aktywacja jest niedostępna bez konfiguracji nadawcy marketingu (`sendingReady = false`):
 * przycisk wyłączony i powiązany z komunikatem na stronie (`senderNoticeId`); serwer odmawia
 * niezależnie od przycisku. O dozwolonych akcjach decyduje strona (`canActivate`/`canCancel`).
 */

export interface EmailCampaignActionsProps {
  id: string;
  slug: string;
  revision: number;
  status: string;
  /** Etykieta statusu (przetłumaczona przez stronę). */
  statusLabel: string;
  canActivate: boolean;
  canCancel: boolean;
  sendingReady: boolean;
  /** `id` komunikatu o braku konfiguracji nadawcy (aria-describedby przycisku aktywacji). */
  senderNoticeId?: string;
  className?: string;
}

type Pending = 'activate' | 'cancel' | null;

export function EmailCampaignActions({
  id,
  slug,
  revision,
  status,
  statusLabel,
  canActivate,
  canCancel,
  sendingReady,
  senderNoticeId,
  className,
}: EmailCampaignActionsProps): React.JSX.Element | null {
  const t = useTranslations('admin');
  const tRoot = useTranslations();
  const feedback = useAdminFeedback();
  const [pending, startTransition] = React.useTransition();
  const [open, setOpen] = React.useState<Pending>(null);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);

  if (!canActivate && !canCancel) return null;

  const close = () => {
    setOpen(null);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  };

  const confirm = () => {
    if (pending || !open) return;
    const kind = open;
    startTransition(async () => {
      try {
        const res =
          kind === 'activate'
            ? await activateEmailCampaign(id, status)
            : await cancelEmailCampaign(id, status);
        if (res.ok) {
          setOpen(null);
          feedback.succeed({
            message: t(kind === 'activate' ? 'campaignActivated' : 'campaignCancelled'),
            focusKey: emailCampaignFocusKey(id),
          });
        } else if (res.reason === 'senderMissing') {
          setOpen(null);
          feedback.succeed({
            message: t('campaignSenderMissingTitle'),
            focusKey: emailCampaignFocusKey(id),
            tone: 'error',
          });
        } else if (res.error === 'STALE_STATE' || res.error === 'NOT_FOUND' || res.error === 'INVALID_TRANSITION') {
          setOpen(null);
          feedback.succeed({
            message: tRoot(toUserMessageKey(res.error)),
            focusKey: emailCampaignFocusKey(id),
            tone: 'error',
          });
        } else {
          feedback.fail(tRoot(toUserMessageKey(res.error)));
        }
      } catch {
        feedback.fail(tRoot(toUserMessageKey('INTERNAL')));
      }
    });
  };

  const openDialog = (kind: 'activate' | 'cancel') => (event: React.MouseEvent<HTMLButtonElement>) => {
    triggerRef.current = event.currentTarget;
    setOpen(kind);
  };

  const details = [
    { key: 'slug', label: t('campaignColSlug'), value: slug },
    { key: 'revision', label: t('campaignColRevision'), value: String(revision) },
    { key: 'status', label: t('campaignColStatus'), value: statusLabel },
  ];

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {canActivate ? (
        <button
          type="button"
          disabled={pending || !sendingReady}
          aria-haspopup="dialog"
          aria-describedby={!sendingReady ? senderNoticeId : undefined}
          onClick={openDialog('activate')}
          className={cn(ADMIN_BUTTON_BASE, ADMIN_ACTION_TONE_CLASS.success)}
        >
          {t('campaignActionActivate')}
        </button>
      ) : null}
      {canCancel ? (
        <button
          type="button"
          disabled={pending}
          aria-haspopup="dialog"
          onClick={openDialog('cancel')}
          className={cn(ADMIN_BUTTON_BASE, ADMIN_ACTION_TONE_CLASS.error)}
        >
          {t('campaignActionCancel')}
        </button>
      ) : null}

      {open ? (
        <AdminConfirmDialog
          title={t(open === 'activate' ? 'campaignActivateConfirmTitle' : 'campaignCancelConfirmTitle')}
          description={t(open === 'activate' ? 'campaignActivateConfirmHint' : 'campaignCancelConfirmHint')}
          details={details}
          confirmLabel={t(open === 'activate' ? 'campaignActionActivate' : 'campaignActionCancel')}
          tone={open === 'activate' ? 'success' : 'error'}
          pending={pending}
          onConfirm={confirm}
          onCancel={close}
        />
      ) : null}
    </div>
  );
}

'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';

import { setContactMessageStatus } from '@/lib/actions/admin';
import { contactMessageFocusKey } from '@/lib/admin/focus';
import { toUserMessageKey, type ErrorCode } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { ADMIN_ACTION_TONE_CLASS, ADMIN_BUTTON_BASE } from '@/components/admin/AdminConfirmDialog';
import { useAdminFeedback } from '@/components/admin/AdminFeedback';

/**
 * ContactMessageActions — „Oznacz jako obsłużoną” / „Przywróć do nowych” (#61, panel admina).
 * Zmiana odwracalna, więc bez dialogu potwierdzenia. CAS po bieżącym statusie w RPC:
 * wiadomość zmieniona w międzyczasie przez innego admina → komunikat `STALE_STATE`.
 * Fokus i komunikaty przez `AdminFeedbackProvider` (#415).
 */
export function ContactMessageActions({
  id,
  status,
}: {
  id: string;
  status: 'new' | 'handled';
}): React.JSX.Element {
  const t = useTranslations('admin');
  const tRoot = useTranslations();
  const feedback = useAdminFeedback();
  const [pending, startTransition] = React.useTransition();
  const next = status === 'new' ? 'handled' : 'new';

  const run = () => {
    if (pending) return;
    startTransition(async () => {
      try {
        const res = await setContactMessageStatus(id, next, status);
        if (res.ok) {
          feedback.succeed({
            message: next === 'handled' ? t('contactMarkedHandled') : t('contactReopened'),
            focusKey: contactMessageFocusKey(id),
          });
        } else if (res.error === 'STALE_STATE' || res.error === 'NOT_FOUND') {
          feedback.succeed({
            message: tRoot(toUserMessageKey(res.error)),
            focusKey: contactMessageFocusKey(id),
            tone: 'error',
          });
        } else {
          feedback.fail(tRoot(toUserMessageKey(res.error as ErrorCode)));
        }
      } catch {
        feedback.fail(tRoot(toUserMessageKey('INTERNAL')));
      }
    });
  };

  return (
    <button
      type="button"
      disabled={pending}
      aria-busy={pending || undefined}
      onClick={run}
      className={cn(ADMIN_BUTTON_BASE, 'border bg-card', ADMIN_ACTION_TONE_CLASS.neutral)}
    >
      {status === 'new' ? t('contactActionHandle') : t('contactActionReopen')}
    </button>
  );
}

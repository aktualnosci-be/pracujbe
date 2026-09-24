'use client';

import { useRouter } from '@/i18n/navigation';
import { BTN_SECONDARY, PANEL, PANEL_H2 } from '@/components/dashboard/panel-styles';
import { cn } from '@/lib/utils';

export function ProfileSummaryError({ message, retry }: {
  message: string;
  retry: string;
}) {
  const router = useRouter();
  return (
    <div role="alert" className={PANEL}>
      <p className={cn(PANEL_H2, 'text-[19px] max-[600px]:text-[19px]')}>{message}</p>
      <button type="button" onClick={() => router.refresh()} className={cn(BTN_SECONDARY, 'mt-4')}>
        {retry}
      </button>
    </div>
  );
}

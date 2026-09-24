'use client';

import { useRouter } from '@/i18n/navigation';
import { BTN_PRIMARY } from '@/components/dashboard/panel-styles';

export function RecentApplicationsError({ message, retryLabel }: { message: string; retryLabel: string }) {
  const router = useRouter();

  return (
    <div role="alert" className="space-y-3">
      <p className="text-[15px] text-foreground">{message}</p>
      <button type="button" className={BTN_PRIMARY} onClick={() => router.refresh()}>
        {retryLabel}
      </button>
    </div>
  );
}

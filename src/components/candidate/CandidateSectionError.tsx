'use client';

import { useRouter } from '@/i18n/navigation';
import { BTN_SECONDARY } from '@/components/dashboard/panel-styles';
import { cn } from '@/lib/utils';

/** Błąd odczytu jednej sekcji pulpitu z ponowieniem; pozostałe sekcje renderują się dalej (#244). */
export function CandidateSectionError({ message, retry }: {
  message: string;
  retry: string;
}) {
  const router = useRouter();
  return (
    <div role="alert" className="min-w-0 py-2">
      <p className="break-words text-[15px] font-semibold text-foreground">{message}</p>
      <button
        type="button"
        onClick={() => router.refresh()}
        className={cn(BTN_SECONDARY, 'mt-4')}
      >
        {retry}
      </button>
    </div>
  );
}

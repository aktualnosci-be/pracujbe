'use client';

import { useRouter } from '@/i18n/navigation';
import { BTN_SECONDARY } from '@/components/dashboard/panel-styles';

/** Ponawia odczyt bieżącej trasy z tym samym parametrem rozmowy. */
export function ThreadRetryButton({ label }: { label: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.refresh()}
      className={BTN_SECONDARY}
    >
      {label}
    </button>
  );
}

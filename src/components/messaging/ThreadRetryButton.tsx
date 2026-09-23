'use client';

import { useRouter } from '@/i18n/navigation';

/** Ponawia odczyt bieżącej trasy z tym samym parametrem rozmowy. */
export function ThreadRetryButton({ label }: { label: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.refresh()}
      className="inline-flex min-h-12 items-center rounded-xl border border-border px-4 font-semibold text-foreground hover:bg-soft"
    >
      {label}
    </button>
  );
}

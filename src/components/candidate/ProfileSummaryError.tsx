'use client';

import { useRouter } from '@/i18n/navigation';

export function ProfileSummaryError({ message, retry }: {
  message: string;
  retry: string;
}) {
  const router = useRouter();
  return (
    <div role="alert" className="rounded-[1.75rem] border border-border bg-card p-5 sm:p-6">
      <p className="text-base font-semibold text-foreground">{message}</p>
      <button type="button" onClick={() => router.refresh()} className="mt-4 inline-flex min-h-12 items-center rounded-xl border border-border px-5 text-sm font-semibold text-foreground hover:bg-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
        {retry}
      </button>
    </div>
  );
}

'use client';

import { useRouter } from '@/i18n/navigation';

/**
 * Błąd odczytu podobnych ofert (#191). Zastępuje tylko tę sekcję — opis oferty, firma
 * i aplikowanie renderują się dalej. Ponowienie odświeża bieżącą trasę (RSC), bez
 * technicznych szczegółów (Invariant #8).
 */
export function SimilarJobsError({ message, retry }: { message: string; retry: string }) {
  const router = useRouter();
  return (
    <div role="alert" data-testid="similar-jobs-error">
      <p className="break-words text-sm text-foreground">{message}</p>
      <button
        type="button"
        onClick={() => router.refresh()}
        className="mt-3 inline-flex min-h-12 items-center rounded-xl border border-border px-4 text-sm font-semibold text-foreground hover:bg-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        {retry}
      </button>
    </div>
  );
}

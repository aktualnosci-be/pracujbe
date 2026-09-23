'use client';

import { useRouter } from 'next/navigation';
import { startTransition, useCallback } from 'react';

/**
 * Ponowienie dla granic błędów App Routera. Samo `reset()` renderuje segment ponownie
 * z TYM SAMYM payloadem RSC, więc błąd z komponentu serwerowego (np. chwilowa awaria
 * odczytu danych) wraca natychmiast. `router.refresh()` pobiera świeże dane serwera,
 * a `reset()` w tej samej transition czyści stan granicy dopiero po ich nadejściu.
 */
export function useErrorRetry(reset: () => void): { retry: () => void } {
  const router = useRouter();
  const retry = useCallback(() => {
    startTransition(() => {
      router.refresh();
      reset();
    });
  }, [router, reset]);
  return { retry };
}

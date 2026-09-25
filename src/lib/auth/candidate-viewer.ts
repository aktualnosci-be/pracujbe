import 'server-only';

import { isAuthRuntimeConfigured, isDatabaseConfigured } from '@/lib/env';
import { captureError } from '@/lib/error-report';

/**
 * UUID zalogowanego kandydata dla listy ofert (#97): baza pomija oferty firm, które
 * zablokował. Tożsamość pochodzi wyłącznie ze zweryfikowanej sesji serwera
 * (`readPortalIdentity`: aktywny profil, potwierdzony e-mail), nigdy z URL ani cookie
 * odczytanego wprost. Gość, pracodawca, admin i brak konfiguracji → `null` (lista gościa).
 *
 * Awaria odczytu sesji nie blokuje listy: wynik gościa zawiera więcej ofert, nie ujawnia
 * żadnych danych, a błąd trafia do kanału błędów.
 */
export async function readCandidateViewerId(): Promise<string | null> {
  if (!isAuthRuntimeConfigured() || !isDatabaseConfigured()) return null;
  try {
    const [{ headers }, { getAuthRuntime }, { getDomainPool }, { readPortalIdentity }] =
      await Promise.all([
        import('next/headers'),
        import('./runtime'),
        import('@/lib/db/runtime'),
        import('./session'),
      ]);
    const [auth, pool, requestHeaders] = await Promise.all([
      getAuthRuntime(),
      getDomainPool(),
      headers(),
    ]);
    const identity = await readPortalIdentity(auth, pool, new Headers(requestHeaders));
    return identity?.role === 'candidate' ? identity.id : null;
  } catch (error) {
    captureError(error, { area: 'auth.readCandidateViewerId' });
    return null;
  }
}

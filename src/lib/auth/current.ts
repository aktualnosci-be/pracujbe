import 'server-only';

import { cache } from 'react';
import { headers } from 'next/headers';

import { isPortalAuthConfigured } from '@/lib/env';
import type { PortalIdentity } from './session';

export type { PortalIdentity } from './session';

/**
 * Tożsamość bieżącego żądania (#24) — JEDYNE wejście dla guardów paneli, Server Actions i warstwy
 * danych (#25/#26). Kontrakt:
 *
 * - `null` = gość: brak/nieważne/odwołane cookie, niepotwierdzony e-mail, profil nieaktywny lub
 *   usunięty. Rola i UUID pochodzą z `public.profiles` odczytanego pod sesją, nigdy z formularza,
 *   URL ani samego cookie (`readPortalIdentity`).
 * - wyjątek = awaria infrastruktury (baza, runtime auth). Wołający ma zakończyć żądanie
 *   kontrolowanym błędem, a NIE traktować awarii jak gościa ani jak dowolnej roli.
 * - Przed użyciem sprawdź `isPortalAuthConfigured()`; bez konfiguracji funkcja rzuca.
 *
 * Dostęp do danych: `withUserTransaction(await getDomainPool(), identity.id, …)` — UUID tylko stąd.
 * Wynik jest zapamiętany na czas jednego renderu (React `cache`), nie między żądaniami: zmiana roli,
 * zawieszenie konta i wylogowanie działają od następnego żądania.
 */
export const getCurrentIdentity = cache(async (): Promise<PortalIdentity | null> => {
  if (!isPortalAuthConfigured()) {
    throw new Error('Konta portalu nie są skonfigurowane.');
  }
  const [{ getAuthRuntime }, { getDomainPool }, { readPortalIdentity }] = await Promise.all([
    import('./runtime'),
    import('@/lib/db/runtime'),
    import('./session'),
  ]);
  const [auth, pool, requestHeaders] = await Promise.all([getAuthRuntime(), getDomainPool(), headers()]);
  return readPortalIdentity(auth, pool, new Headers(requestHeaders));
});

export interface OwnProfileSummary {
  firstName: string;
  lastName: string;
}

/**
 * Imię i nazwisko zalogowanej osoby do chrome panelu (pod RLS: własny wiersz profilu).
 * Błąd odczytu → `null` (panel pokazuje neutralną etykietę), nigdy dane zastępcze.
 */
export async function readOwnProfileSummary(identity: PortalIdentity): Promise<OwnProfileSummary | null> {
  try {
    const [{ getDomainPool }, { withUserTransaction }] = await Promise.all([
      import('@/lib/db/runtime'),
      import('@/lib/db/transaction'),
    ]);
    return await withUserTransaction(await getDomainPool(), identity.id, async (tx) => {
      const result = (await tx.query(
        'SELECT first_name, last_name FROM public.profiles WHERE id = $1',
        [identity.id],
      )) as { rows: { first_name: string | null; last_name: string | null }[] };
      const row = result.rows[0];
      return row ? { firstName: row.first_name ?? '', lastName: row.last_name ?? '' } : null;
    });
  } catch {
    return null;
  }
}

/** Pełne imię i nazwisko albo `undefined` (brak danych) — etykieta topbara panelu. */
export function displayName(summary: OwnProfileSummary | null): string | undefined {
  if (!summary) return undefined;
  const full = `${summary.firstName.trim()} ${summary.lastName.trim()}`.trim();
  return full.length > 0 ? full : undefined;
}

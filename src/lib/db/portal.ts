import 'server-only';

import { cache } from 'react';

import type { PortalIdentity } from '@/lib/auth/session';
import { isAuthRuntimeConfigured, isDatabaseConfigured } from '@/lib/env';
import { withServiceTransaction } from './service';
import { withUserTransaction, type TransactionQuery } from './transaction';

/**
 * Wejście serwerowej warstwy danych paneli (#25).
 *
 * - `getPortalIdentity()` — tożsamość z sesji serwerowej (Better Auth, `readPortalIdentity`:
 *   aktywny profil, potwierdzony e-mail, rola z bazy). Jeden odczyt na żądanie (`cache`).
 * - `withPortalTransaction(identity, …)` — jedno połączenie z puli domeny, `SET LOCAL ROLE
 *   authenticated` + `app.current_uid` = UUID z sesji; RLS decyduje w bazie. `null` = gość (anon).
 * - `withServiceRole(…)` — osobna pula `service` wyłącznie dla zadań uprzywilejowanych
 *   (worker poczty, webhooki, cron, odczyty admina po `requireAdmin`).
 *
 * Tożsamość przyjmowana przez transakcję musi pochodzić z `getPortalIdentity()` tego procesu —
 * obiekt spoza niej (np. złożony z danych formularza) jest odrzucany.
 */

const verified = new WeakSet<PortalIdentity>();

/** Czy backend PostgreSQL + sesje są skonfigurowane (inaczej: tryb demo paneli). */
export function isPortalDataConfigured(): boolean {
  return isDatabaseConfigured() && isAuthRuntimeConfigured();
}

async function readIdentity(): Promise<PortalIdentity | null> {
  if (!isPortalDataConfigured()) return null;
  const [{ headers }, { getAuthRuntime }, { getDomainPool }, { readPortalIdentity }] =
    await Promise.all([
      import('next/headers'),
      import('@/lib/auth/runtime'),
      import('./runtime'),
      import('@/lib/auth/session'),
    ]);
  const [auth, pool, requestHeaders] = await Promise.all([getAuthRuntime(), getDomainPool(), headers()]);
  const identity = await readPortalIdentity(auth, pool, new Headers(requestHeaders));
  if (!identity) return null;
  const frozen = Object.freeze({ id: identity.id, role: identity.role });
  verified.add(frozen);
  return frozen;
}

/** Zalogowany użytkownik bieżącego żądania albo null (gość / brak konfiguracji). */
export const getPortalIdentity = cache(readIdentity);

/** Transakcja pod RLS jako użytkownik sesji (albo gość dla `null`). */
export async function withPortalTransaction<T>(
  identity: PortalIdentity | null,
  action: (tx: TransactionQuery) => Promise<T>,
): Promise<T> {
  if (identity !== null && !verified.has(identity)) {
    throw new Error('Tożsamość nie pochodzi z sesji serwera.');
  }
  const { getDomainPool } = await import('./runtime');
  return withUserTransaction(await getDomainPool(), identity?.id ?? null, action);
}

/** Transakcja service_role na osobnej puli zadań serwerowych. */
export async function withServiceRole<T>(action: (tx: TransactionQuery) => Promise<T>): Promise<T> {
  const { getServicePool } = await import('./runtime');
  return withServiceTransaction(await getServicePool(), action);
}

/** Czy pula zadań serwerowych jest skonfigurowana (worker, webhooki, cron, admin). */
export function isServiceDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_SERVICE_URL);
}

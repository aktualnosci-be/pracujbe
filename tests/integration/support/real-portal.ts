/**
 * `@/lib/db/portal` na prawdziwych pulach izolowanej bazy (#25): loadery i akcje działają
 * dokładnie tą samą ścieżką co w produkcji (`withUserTransaction` → RLS, pula `service`).
 * Tożsamość ustawia test (`realSession.identity`) — odpowiednik zweryfikowanej sesji.
 *
 *   vi.mock('@/lib/db/portal', async () => (await import('./support/real-portal')).realPortal());
 */
import type { PortalIdentity } from '../../../src/lib/auth/session';
import { withServiceTransaction } from '../../../src/lib/db/service';
import { withUserTransaction, type TransactionQuery } from '../../../src/lib/db/transaction';
import type { PortalDb } from './portal-db';

export const realSession: { db: PortalDb | null; identity: PortalIdentity | null } = { db: null, identity: null };

export function actAs(identity: PortalIdentity | null) {
  realSession.identity = identity;
}

function db(): PortalDb {
  if (!realSession.db) throw new Error('Baza testowa nie jest uruchomiona.');
  return realSession.db;
}

export function realPortal() {
  return {
    isPortalDataConfigured: () => true,
    isServiceDatabaseConfigured: () => true,
    getPortalIdentity: async () => realSession.identity,
    withPortalTransaction: async <T>(identity: PortalIdentity | null, action: (tx: TransactionQuery) => Promise<T>) =>
      withUserTransaction(db().web, identity?.id ?? null, action),
    withServiceRole: async <T>(action: (tx: TransactionQuery) => Promise<T>) =>
      withServiceTransaction(db().service, action),
  };
}

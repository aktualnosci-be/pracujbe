import 'server-only';
import { withUserTransaction, type TransactionPool } from '../db/transaction';
import { AppError } from '../errors';

interface SessionReader {
  api: {
    getSession(input: { headers: Headers }): Promise<{
      user: { id: string; emailVerified: boolean };
      session: { expiresAt: Date };
    } | null>;
  };
}

export interface PortalIdentity {
  id: string;
  role: 'candidate' | 'employer' | 'admin';
}

/**
 * Sesja SDK potwierdza tożsamość, profil w bazie określa bieżące uprawnienia.
 * Bez cache między żądaniami; zmiana roli lub zawieszenie działa przy kolejnym odczycie.
 * Przekazywane headers należą do bieżącego żądania serwera, nigdy do formularza.
 */
export async function readPortalIdentity(
  auth: SessionReader,
  pool: TransactionPool,
  headers: Headers,
): Promise<PortalIdentity | null> {
  const session = await auth.api.getSession({ headers });
  if (!session || !session.user.emailVerified) return null;
  const expiresAt = session.session.expiresAt.getTime();
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
  return withUserTransaction(pool, session.user.id, async transaction => {
    const result = await transaction.query(
      'SELECT id, role FROM public.profiles WHERE id = $1 AND is_active = true AND deleted_at IS NULL',
      [session.user.id],
    ) as { rows: { id: string; role: string }[] };
    const profile = result.rows[0];
    if (!profile) return null;
    if (profile.id !== session.user.id || !['candidate', 'employer', 'admin'].includes(profile.role)) {
      throw new AppError('PERMISSION_DENIED');
    }
    return { id: profile.id, role: profile.role as PortalIdentity['role'] };
  });
}

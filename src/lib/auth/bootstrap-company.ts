import 'server-only';

import { randomUUID } from 'node:crypto';
import { withUserTransaction, type TransactionPool } from '../db/transaction';
import { AppError } from '../errors';
import { registerEmployerSchema } from '../validation/auth';

export interface CompanyBootstrapResult {
  companyId: string;
  created: boolean;
}

/**
 * Wewnętrzny bootstrap po zweryfikowaniu sesji i adresu e-mail przez adapter auth.
 * trustedUserId pochodzi wyłącznie z tego adaptera, nazwa z danych rejestracji.
 * Blokada profilu serializuje tylko automatyczny bootstrap; nie ogranicza liczby
 * firm, które właściciel może później świadomie utworzyć osobną akcją.
 */
export async function bootstrapCompany(
  pool: TransactionPool,
  trustedUserId: string,
  companyName: string,
): Promise<CompanyBootstrapResult> {
  const name = registerEmployerSchema.innerType().shape.companyName.safeParse(companyName);
  if (!name.success) throw new AppError('VALIDATION_FAILED');

  return withUserTransaction(pool, trustedUserId, async (transaction) => {
    const profile = await transaction.query(
      'SELECT role, is_active, deleted_at FROM public.profiles WHERE id = $1 FOR UPDATE',
      [trustedUserId],
    ) as { rows: { role: string; is_active: boolean; deleted_at: unknown }[] };
    const current = profile.rows[0];
    if (!current || current.role !== 'employer' || !current.is_active || current.deleted_at !== null) {
      throw new AppError('PERMISSION_DENIED');
    }

    // Ponowny odczyt PO uzyskaniu blokady. Nieaktywne członkostwo także kończy
    // bootstrap: odebranie dostępu nie może tworzyć zastępczej firmy.
    const membership = await transaction.query(
      'SELECT company_id FROM public.company_members WHERE profile_id = $1 ORDER BY created_at, id LIMIT 1',
      [trustedUserId],
    ) as { rows: { company_id: string }[] };
    if (membership.rows[0]) return { companyId: membership.rows[0].company_id, created: false };

    const result = await transaction.query(
      'SELECT public.create_company_with_owner($1, $2) AS company_id',
      [name.data, `firma-${randomUUID()}`],
    ) as { rows: { company_id: string }[] };
    const companyId = result.rows[0]?.company_id;
    if (!companyId) throw new AppError('INTERNAL');
    return { companyId, created: true };
  });
}

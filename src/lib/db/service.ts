import 'server-only';

import type { TransactionPool, TransactionQuery } from './transaction';

/**
 * Transakcja zadania uprzywilejowanego (#25) na puli `service` (login z jedynym
 * członkostwem service_role, rola ustawiona opcją startową połączenia). Kontekst
 * użytkownika jest jawnie pusty: `auth.uid()` = NULL, tak jak dla klucza service-role.
 * Rola jest ponownie ustawiana lokalnie — połączenie z puli nie może jej zmienić.
 * Połączenie o nieznanym stanie po nieudanym ROLLBACK jest niszczone.
 */
export async function withServiceTransaction<T>(
  pool: TransactionPool,
  action: (transaction: TransactionQuery) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let destroy = false;
  let active = false;
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE service_role');
    await client.query("SELECT set_config('app.current_uid', '', true)");
    active = true;
    const transaction = Object.freeze({ query: async (text: string, values?: unknown[]) => {
      if (!active) throw new Error('Transakcja została zakończona.');
      return client.query(text, values);
    } });
    const result = await action(transaction);
    active = false;
    await client.query('COMMIT');
    return result;
  } catch (error) {
    active = false;
    try {
      await client.query('ROLLBACK');
    } catch {
      destroy = true;
    }
    throw error;
  } finally {
    client.release(destroy);
  }
}

import 'server-only';

/** Minimalny kontrakt pg.PoolClient; nie wymaga importowania sterownika do domeny. */
export interface TransactionClient {
  query(text: string, values?: unknown[]): Promise<unknown>;
  release(destroy?: boolean): void;
}

export interface TransactionPool {
  connect(): Promise<TransactionClient>;
}

export interface TransactionQuery {
  query(text: string, values?: unknown[]): Promise<unknown>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * UUID musi pochodzić z sesji zweryfikowanej na serwerze, nigdy z formularza/URL.
 * null oznacza gościa. Brak opcji service_role: zadania uprzywilejowane są osobne.
 * Pula musi używać ograniczonego loginu bootstrapu, nie migratora postgres.
 * Callback otrzymuje tylko zapytania, bez możliwości zwolnienia połączenia.
 */
export async function withUserTransaction<T>(
  pool: TransactionPool,
  trustedUserId: string | null,
  action: (transaction: TransactionQuery) => Promise<T>,
): Promise<T> {
  if (trustedUserId !== null && (typeof trustedUserId !== 'string' || !UUID.test(trustedUserId))) {
    throw new Error('Nieprawidłowa tożsamość sesji.');
  }

  const client = await pool.connect();
  let destroy = false;
  let active = false;
  try {
    await client.query('BEGIN');
    // Nazwy ról są stałe, nie interpolujemy żadnej wartości od wywołującego.
    await client.query(trustedUserId === null ? 'SET LOCAL ROLE anon' : 'SET LOCAL ROLE authenticated');
    // Jawnie czyścimy również kontekst gościa; nie polegamy na stanie puli.
    await client.query("SELECT set_config('app.current_uid', $1, true)", [trustedUserId ?? '']);
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
      // Nie oddajemy do puli połączenia o nieznanym stanie transakcji/tożsamości.
      destroy = true;
    }
    throw error;
  } finally {
    client.release(destroy);
  }
}

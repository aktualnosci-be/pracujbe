import { describe, expect, it, vi } from 'vitest';
import { withUserTransaction, type TransactionClient, type TransactionPool } from '@/lib/db/transaction';

const user = '11111111-1111-4111-8111-111111111111';
function setup() {
  const query = vi.fn<TransactionClient['query']>().mockResolvedValue({ rows: [] });
  const release = vi.fn<TransactionClient['release']>();
  const client = { query, release };
  const pool = { connect: vi.fn<TransactionPool['connect']>().mockResolvedValue(client) };
  return { pool, query, release };
}

describe('Transakcja pod tożsamością użytkownika', () => {
  it('używa jednego połączenia i lokalnego, parametryzowanego kontekstu', async () => {
    const { pool, query, release } = setup();
    const result = await withUserTransaction(pool, user, async transaction => {
      expect(Object.isFrozen(transaction)).toBe(true);
      expect(transaction).not.toHaveProperty('release');
      await transaction.query('SELECT $1', [42]);
      return 42;
    });
    expect(result).toBe(42);
    expect(pool.connect).toHaveBeenCalledTimes(1);
    expect(query.mock.calls).toEqual([
      ['BEGIN'], ['SET LOCAL ROLE authenticated'],
      ["SELECT set_config('app.current_uid', $1, true)", [user]],
      ['SELECT $1', [42]], ['COMMIT'],
    ]);
    expect(release).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('po kandydacie jawnie zeruje tożsamość gościa na ponownie użytym połączeniu', async () => {
    const { pool, query } = setup();
    await withUserTransaction(pool, user, async () => undefined);
    query.mockClear();
    await withUserTransaction(pool, null, async () => undefined);
    expect(query.mock.calls).toEqual([
      ['BEGIN'], ['SET LOCAL ROLE anon'],
      ["SELECT set_config('app.current_uid', $1, true)", ['']], ['COMMIT'],
    ]);
  });

  it.each(['', 'service_role', "x'; SET ROLE postgres; --", 'not-a-uuid'])('odrzuca nieprawidłowe UUID przed pobraniem połączenia: %s', async value => {
    const { pool } = setup();
    await expect(withUserTransaction(pool, value, async () => undefined)).rejects.toThrow('Nieprawidłowa tożsamość sesji.');
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it.each(['BEGIN', 'SET LOCAL ROLE authenticated', "SELECT set_config('app.current_uid', $1, true)", 'COMMIT'])('cofa transakcję po błędzie %s', async failure => {
    const { pool, query, release } = setup();
    const original = new Error('Błąd testowy');
    query.mockImplementation(async text => { if (text === failure) throw original; return {}; });
    await expect(withUserTransaction(pool, user, async () => 1)).rejects.toBe(original);
    expect(query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(release).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('cofa błąd callbacku i nie zatwierdza częściowego zapisu', async () => {
    const { pool, query, release } = setup();
    const original = new Error('Błąd domenowy');
    await expect(withUserTransaction(pool, user, async transaction => {
      await transaction.query('INSERT INTO test VALUES ($1)', [1]);
      throw original;
    })).rejects.toBe(original);
    expect(query).not.toHaveBeenCalledWith('COMMIT');
    expect(query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(release).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('usuwa połączenie z puli, gdy rollback nie działa, zachowując pierwotny błąd', async () => {
    const { pool, query, release } = setup();
    const original = new Error('Błąd domenowy');
    query.mockImplementation(async text => { if (text === 'ROLLBACK') throw new Error('Sieć'); return {}; });
    await expect(withUserTransaction(pool, user, async () => { throw original; })).rejects.toBe(original);
    expect(release).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('nie próbuje zwalniać nieuzyskanego połączenia', async () => {
    const { pool, query, release } = setup();
    pool.connect.mockRejectedValue(new Error('Połączenie niedostępne'));
    await expect(withUserTransaction(pool, null, async () => undefined)).rejects.toThrow('Połączenie niedostępne');
    expect(query).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });

  it('zachowany callback nie użyje połączenia po jego zwróceniu do puli', async () => {
    const { pool, query } = setup();
    const transaction = await withUserTransaction(pool, user, async context => context);
    const count = query.mock.calls.length;
    await expect(transaction.query('SELECT 1')).rejects.toThrow('Transakcja została zakończona.');
    expect(query).toHaveBeenCalledTimes(count);
  });
});

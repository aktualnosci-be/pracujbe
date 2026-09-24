import 'server-only';
import { Pool, type PoolConfig } from 'pg';

export type DatabasePurpose = 'domain' | 'auth' | 'ops';
/** 'ops' (#47, 0096): login monitoringu — wyłącznie EXECUTE na public.ops_metrics(). */
const roles = { domain: 'pracujbe_app', auth: 'pracujbe_auth', ops: 'pracujbe_ops' } as const;

/** Konfiguracja jawna; nie odczytuje DATABASE_URL migratora ani nie łączy przy imporcie. */
export function runtimePoolConfig(connectionString: string, purpose: DatabasePurpose): PoolConfig {
  let url: URL;
  try { url = new URL(connectionString); }
  catch { throw new Error('Nieprawidłowa konfiguracja połączenia bazy.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname ||
      !url.username || url.pathname.length < 2 || !Object.hasOwn(roles, purpose)) {
    throw new Error('Niepełna konfiguracja połączenia bazy.');
  }
  // pg pozwala parametrom URL nadpisać options; rola/search_path muszą być nasze.
  for (const key of url.searchParams.keys()) {
    if (!['sslmode', 'sslrootcert'].includes(key)) {
      throw new Error('Niedozwolony parametr połączenia bazy.');
    }
  }
  if (url.searchParams.get('sslmode') === 'no-verify') {
    throw new Error('Weryfikacja certyfikatu bazy nie może być wyłączona.');
  }
  return {
    connectionString,
    // Monitoring nie może zająć połączeń aplikacji: jedna sesja na proces.
    max: purpose === 'ops' ? 1 : 5,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    options: `-c role=${roles[purpose]} -c search_path=${purpose === 'auth' ? 'auth' : 'public'} -c statement_timeout=30000 -c idle_in_transaction_session_timeout=30000`,
  };
}

/**
 * Osobny login NOINHERIT dla każdej puli. Opcje startup obowiązują każde połączenie.
 * Kontrola odrzuca URL migratora: samo SET ROLE nie odbiera superuserowi eskalacji.
 */
export async function createRuntimePool(connectionString: string, purpose: DatabasePurpose): Promise<Pool> {
  const pool = new Pool(runtimePoolConfig(connectionString, purpose));
  pool.on('error', () => { console.error('Utracono bezczynne połączenie z bazą.'); });
  try {
    const result = await pool.query<{ valid: boolean }>(`
      SELECT current_user = $1 AND r.rolcanlogin AND NOT r.rolsuper
        AND NOT r.rolcreatedb AND NOT r.rolcreaterole AND NOT r.rolinherit
        AND NOT r.rolbypassrls
        AND NOT EXISTS (
          SELECT 1 FROM pg_auth_members m
          WHERE m.member = r.oid AND (m.roleid <> $1::regrole OR m.admin_option)
        )
        AND NOT EXISTS (SELECT 1 FROM pg_database d WHERE d.datname = current_database() AND d.datdba = r.oid)
        AS valid
      FROM pg_roles r WHERE r.rolname = session_user`, [roles[purpose]]);
    if (result.rows[0]?.valid !== true) throw new Error('Nieprawidłowe uprawnienia loginu bazy.');
    return pool;
  } catch {
    await pool.end();
    // Nie przenosimy błędu sterownika: może zawierać adres lub nazwę użytkownika.
    throw new Error('Nie można uruchomić ograniczonej puli połączeń.');
  }
}

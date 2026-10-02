import 'server-only';
import { Pool, type PoolConfig } from 'pg';

export type DatabasePurpose = 'domain' | 'auth' | 'ops' | 'rate_limit' | 'auth_mail' | 'service';
/**
 * 'ops' (#47, 0096): login monitoringu — wyłącznie EXECUTE na public.ops_metrics().
 * 'rate_limit' (0058): login limitera — wyłącznie EXECUTE na public.rate_limit_hit().
 * 'auth_mail' (0061): worker wiadomości auth — wyłącznie funkcje claim/complete/fail/expire.
 * 'service' (#25): login zadań uprzywilejowanych (worker poczty, webhooki, cron, odczyty
 * panelu admina) — jedyne członkostwo service_role; nigdy w zwykłych loaderach.
 */
const roles = {
  domain: 'pracujbe_app',
  auth: 'pracujbe_auth',
  ops: 'pracujbe_ops',
  rate_limit: 'pracujbe_rate_limit',
  auth_mail: 'pracujbe_auth_mail',
  service: 'service_role',
} as const;
/** Serwerowy limit zapytania (`statement_timeout` w opcjach startowych każdego połączenia). */
export const STATEMENT_TIMEOUT_MS = 30_000;
/**
 * Kliencki limit czasu zapytania (#1229) — nieco dłuższy od `statement_timeout`, więc zwykle
 * pierwszy zadziała serwer (czytelny błąd `57014`). Chroni przed półotwartym połączeniem
 * (zerwana sieć bez RST, failover proxy bazy): serwer nie odpowie wcale, `statement_timeout`
 * nic nie da, a `pg` bez `query_timeout` czeka bez końca — to zatruwało single-flight
 * healthchecku (`/api/health`) i trwale zajmowało slot puli.
 */
export const CLIENT_QUERY_TIMEOUT_MS = 35_000;
/** TCP keepalive (#1229): martwe połączenie wykrywa system, zanim trafi do niego kolejne zapytanie. */
export const KEEP_ALIVE_INITIAL_DELAY_MS = 10_000;
const authSchemaPurposes: ReadonlySet<DatabasePurpose> = new Set(['auth', 'auth_mail']);

/**
 * Limit połączeń puli domenowej (#1096): jeden widok pulpitu pracodawcy otwiera równolegle
 * ok. 8 transakcji, więc dawne `max=5` kolejkowało je już przy jednym użytkowniku.
 * Domyślnie 10; `DATABASE_APP_POOL_MAX` (liczba całkowita 1–50) nadpisuje — pilnuj, żeby
 * liczba replik × limit mieściła się w `max_connections` bazy. Zła wartość = domyślna.
 */
export const DEFAULT_DOMAIN_POOL_MAX = 10;
export function domainPoolMax(env: Record<string, string | undefined> = process.env): number {
  const raw = env.DATABASE_APP_POOL_MAX?.trim();
  if (!raw || !/^\d{1,2}$/.test(raw)) return DEFAULT_DOMAIN_POOL_MAX;
  const value = Number(raw);
  return value >= 1 && value <= 50 ? value : DEFAULT_DOMAIN_POOL_MAX;
}

/** Konfiguracja jawna; nie odczytuje DATABASE_URL migratora ani nie łączy przy imporcie. */
export function runtimePoolConfig(
  connectionString: string,
  purpose: DatabasePurpose,
  env: Record<string, string | undefined> = process.env,
): PoolConfig {
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
    // Monitoring i worker poczty nie mogą zająć połączeń aplikacji: mniej sesji na proces.
    max: purpose === 'ops' ? 1 : purpose === 'auth_mail' || purpose === 'rate_limit' ? 2 : purpose === 'service' ? 3 : purpose === 'domain' ? domainPoolMax(env) : 5,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    query_timeout: CLIENT_QUERY_TIMEOUT_MS,
    keepAlive: true,
    keepAliveInitialDelayMillis: KEEP_ALIVE_INITIAL_DELAY_MS,
    options: `-c role=${roles[purpose]} -c search_path=${authSchemaPurposes.has(purpose) ? 'auth' : 'public'} -c statement_timeout=${STATEMENT_TIMEOUT_MS} -c idle_in_transaction_session_timeout=30000`,
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

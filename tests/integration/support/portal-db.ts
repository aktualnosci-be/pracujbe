/**
 * Izolowany PostgreSQL 16 dla testów warstwy danych paneli (#25).
 *
 * Domyślnie (CI) własny kontener Dockera z losową nazwą i portem. Lokalnie bez Dockera:
 * `INTEGRATION_PG_ADMIN_URL=postgresql://postgres@127.0.0.1:55432/postgres` — tworzymy
 * na tym serwerze nową bazę o losowej nazwie `portal_it_*` i usuwamy ją po teście.
 * Nigdy nie czytamy DATABASE_URL/DATABASE_APP_URL z otoczenia.
 *
 * Schemat = pełny zestaw migracji produkcyjnych (`loadProductionMigrations`). Loginy
 * runtime jak w produkcji: `web` (jedyne członkostwo pracujbe_app) i `service`
 * (jedyne członkostwo service_role), sprawdzane przez `createRuntimePool`.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { loadProductionMigrations } from '../../../scripts/db/production-migrations.mjs';
import { applyMigrations } from '../../../scripts/db/migrate.mjs';
import { createRuntimePool } from '../../../src/lib/db/pool';

export interface PortalDb {
  admin: Pool;
  web: Pool;
  service: Pool;
  /** Tworzy konto (auth.users → trigger profilu) i zwraca UUID. */
  createUser(role: 'candidate' | 'employer' | 'admin', locale?: string): Promise<string>;
  stop(): Promise<void>;
}

function docker(...args: string[]): string {
  const windows = process.platform === 'win32';
  return execFileSync(windows ? 'wsl.exe' : 'docker',
    windows ? ['-d', 'Ubuntu', '--', 'docker', ...args] : args,
    { encoding: 'utf8', timeout: 90_000 }).trim();
}

async function waitFor(pool: Pool) {
  for (let attempt = 0; attempt < 80; attempt++) {
    try { await pool.query('SELECT 1'); return; }
    catch { await new Promise((resolve) => setTimeout(resolve, 250)); }
  }
  throw new Error('Izolowany PostgreSQL nie uruchomił się.');
}

export async function startPortalDb(): Promise<PortalDb> {
  const password = randomUUID();
  const database = `portal_it_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  const external = process.env.INTEGRATION_PG_ADMIN_URL;
  let base: URL;
  let cleanup: () => Promise<void>;

  if (external) {
    const serverUrl = new URL(external);
    const server = new Pool({ connectionString: external, max: 1 });
    await waitFor(server);
    await server.query(`CREATE DATABASE ${database}`);
    base = new URL(serverUrl.toString());
    base.pathname = `/${database}`;
    cleanup = async () => {
      try {
        await server.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1', [database]);
        await server.query(`DROP DATABASE IF EXISTS ${database}`);
        // Loginy są obiektami klastra — usuwamy tylko własne, losowo nazwane.
      } finally { await server.end(); }
    };
  } else {
    const container = `pracujbe-portal-it-${randomUUID()}`;
    docker('run', '--detach', '--rm', '--name', container,
      '--publish', '127.0.0.1::5432', '--tmpfs', '/var/lib/postgresql/data',
      '--env', `POSTGRES_PASSWORD=${password}`, '--env', `POSTGRES_DB=${database}`, 'postgres:16');
    const port = Number(docker('port', container, '5432/tcp').split(':').at(-1));
    if (!Number.isInteger(port) || port < 1) throw new Error('Brak portu izolowanej bazy.');
    base = new URL(`postgresql://postgres:${password}@127.0.0.1:${port}/${database}`);
    cleanup = async () => { docker('rm', '--force', container); };
  }

  const admin = new Pool({ connectionString: base.toString(), max: 2 });
  // Sprzątanie bazy (pg_terminate_backend) może zamknąć bezczynne połączenie — to nie błąd testu.
  admin.on('error', () => undefined);
  await waitFor(admin);
  const migrations = await loadProductionMigrations();
  const migrator = await admin.connect();
  try { await applyMigrations(migrator, migrations); }
  finally { migrator.release(); }

  const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
  const webLogin = `it_web_${suffix}`;
  const serviceLogin = `it_service_${suffix}`;
  await admin.query(`CREATE ROLE ${webLogin} LOGIN PASSWORD '${password}'
      NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
    GRANT pracujbe_app TO ${webLogin};
    CREATE ROLE ${serviceLogin} LOGIN PASSWORD '${password}'
      NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
    GRANT service_role TO ${serviceLogin};`);
  const loginUrl = (user: string) => {
    const url = new URL(base.toString());
    url.username = user;
    url.password = password;
    return url.toString();
  };
  const web = await createRuntimePool(loginUrl(webLogin), 'domain');
  const service = await createRuntimePool(loginUrl(serviceLogin), 'service');

  return {
    admin,
    web,
    service,
    async createUser(role, locale = 'pl') {
      const id = randomUUID();
      await admin.query(`INSERT INTO auth.users(id, email, name, raw_user_meta_data)
        VALUES ($1, $2, 'Test', $3::jsonb)`, [id, `${id}@example.invalid`, JSON.stringify({ role, locale })]);
      // #492: kandydat z formularza rejestracji ma deklarację progu wieku (bez niej baza
      // odrzuca aplikację, propozycję i widoczność profilu).
      if (role === 'candidate') {
        await admin.query('SELECT public.record_candidate_age_attestation($1, 18, $2)', [id, locale]);
      }
      return id;
    },
    async stop() {
      try { await Promise.all([web.end(), service.end()]); }
      finally {
        try {
          await admin.query(`DROP OWNED BY ${webLogin}, ${serviceLogin}; DROP ROLE ${webLogin}; DROP ROLE ${serviceLogin};`)
            .catch(() => undefined);
          await admin.end();
        } finally { await cleanup(); }
      }
    },
  };
}

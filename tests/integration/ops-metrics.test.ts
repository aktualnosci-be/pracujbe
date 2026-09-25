import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadProductionMigrations } from '../../scripts/db/production-migrations.mjs';
import { applyMigrations } from '../../scripts/db/migrate.mjs';
import { createRuntimePool } from '../../src/lib/db/pool';
import { evaluateOps, parseOpsMetrics } from '../../src/lib/ops/sensors';

// #47: rzeczywisty login monitoringu (członkostwo tylko pracujbe_ops) na PostgreSQL 16.
const container = `pracujbe-ops-test-${randomUUID()}`;
const password = randomUUID();
let port: number;
let created = false;
let admin: Pool | undefined;
const pools: Pool[] = [];

function docker(...args: string[]): string {
  const windows = process.platform === 'win32';
  return execFileSync(windows ? 'wsl.exe' : 'docker',
    windows ? ['-d', 'Ubuntu', '--', 'docker', ...args] : args,
    { encoding: 'utf8', timeout: 60_000 }).trim();
}

const url = (user: string) => `postgresql://${user}:${password}@127.0.0.1:${port}/ops_test`;

beforeAll(async () => {
  docker('run', '--detach', '--rm', '--name', container,
    '--publish', '127.0.0.1::5432', '--tmpfs', '/var/lib/postgresql/data',
    '--env', `POSTGRES_PASSWORD=${password}`, '--env', 'POSTGRES_DB=ops_test', 'postgres:16');
  created = true;
  port = Number(docker('port', container, '5432/tcp').split(':').at(-1));
  if (!Number.isInteger(port) || port < 1) throw new Error('Brak portu izolowanej bazy.');
  admin = new Pool({ connectionString: url('postgres'), max: 1, connectionTimeoutMillis: 2_000 });
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { await admin.query('SELECT 1'); ready = true; break; }
    catch { await new Promise((resolve) => setTimeout(resolve, 250)); }
  }
  if (!ready) throw new Error('Izolowany PostgreSQL nie uruchomił się.');
  const migrations = await loadProductionMigrations();
  const migrator = await admin.connect();
  try { expect((await applyMigrations(migrator, migrations)).applied).toBe(migrations.length); }
  finally { migrator.release(); }
  await admin.query(`
    CREATE ROLE ops_monitor LOGIN PASSWORD '${password}' NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
    GRANT pracujbe_ops TO ops_monitor;
    CREATE ROLE ops_too_wide LOGIN PASSWORD '${password}' NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
    GRANT pracujbe_ops, pracujbe_app TO ops_too_wide;`);
});

afterAll(async () => {
  try { await Promise.all(pools.map((pool) => pool.end())); }
  finally {
    try { await admin?.end(); }
    finally { if (created) docker('rm', '--force', container); }
  }
});

describe('Login monitoringu pracujbe_ops (#47)', () => {
  it('czyta ops_metrics() w kształcie oczekiwanym przez aplikację', async () => {
    const pool = await createRuntimePool(url('ops_monitor'), 'ops');
    pools.push(pool);
    const { rows } = await pool.query<{ metrics: unknown }>('SELECT public.ops_metrics() AS metrics');
    const metrics = parseOpsMetrics(rows[0]?.metrics);
    expect(metrics).not.toBeNull();
    expect(metrics!.authEmail).not.toBeNull();
    expect(metrics!.connections.used).toBeGreaterThanOrEqual(1);
    expect(evaluateOps(metrics!).status).toBe('ok');
  });

  it('#44: skok trwałych odbić i blokad → alarm poczty; po sprzątnięciu → ok (recovery)', async () => {
    const pool = await createRuntimePool(url('ops_monitor'), 'ops');
    pools.push(pool);
    const read = async () => {
      const { rows } = await pool.query<{ metrics: unknown }>('SELECT public.ops_metrics() AS metrics');
      const metrics = parseOpsMetrics(rows[0]?.metrics);
      expect(metrics?.mail).not.toBeNull();
      return metrics!;
    };
    expect(evaluateOps(await read()).alerts).toEqual([]);

    // 60 listów z 24 h, 6 trwałych odbić (10% > 5%) i 25 nowych blokad (> 20).
    await admin!.query(`
      INSERT INTO public.email_deliveries (to_email, template, status, sent_at, bounce_type, bounced_at)
      SELECT 'ops44-' || g || '@test.invalid', 'newMessage',
             (CASE WHEN g <= 6 THEN 'bounced' ELSE 'delivered' END)::public.email_status,
             now() - interval '1 hour',
             CASE WHEN g <= 6 THEN 'permanent' END,
             CASE WHEN g <= 6 THEN now() - interval '30 minutes' END
        FROM generate_series(1, 60) g;
      INSERT INTO public.email_suppressions (email, reason)
      SELECT 'ops44-block-' || g || '@test.invalid', 'hard_bounce' FROM generate_series(1, 25) g;`);
    const alerting = await read();
    expect(alerting.mail).toMatchObject({ sentLast24h: 60, hardBouncesLast24h: 6, newSuppressionsLast24h: 25 });
    expect(evaluateOps(alerting)).toMatchObject({
      status: 'alert', alerts: ['mail_hard_bounce_rate', 'mail_suppressions_new'],
    });
    expect(JSON.stringify(alerting)).not.toContain('@');

    await admin!.query(`
      DELETE FROM public.email_suppressions WHERE email::text LIKE 'ops44-%';
      DELETE FROM public.email_deliveries WHERE to_email LIKE 'ops44-%';`);
    expect(evaluateOps(await read())).toMatchObject({ status: 'ok', alerts: [] });
  });

  it('nie czyta tabel ani nie przełącza się na role aplikacji', async () => {
    const pool = await createRuntimePool(url('ops_monitor'), 'ops');
    pools.push(pool);
    for (const sql of [
      'SELECT count(*) FROM public.email_deliveries',
      'SELECT count(*) FROM auth.email_outbox',
      'SELECT count(*) FROM public.email_suppressions',
      'SELECT public.expire_due_jobs()',
      'SET ROLE pracujbe_app',
      'SET ROLE service_role',
    ]) {
      await expect(pool.query(sql), sql).rejects.toThrow(/permission denied/);
    }
  });

  it('odrzuca login z dodatkowym członkostwem (kontrola ujemna)', async () => {
    await expect(createRuntimePool(url('ops_too_wide'), 'ops')).rejects.toThrow(
      'Nie można uruchomić ograniczonej puli połączeń.');
  });

  it('login monitoringu nie otwiera puli domenowej', async () => {
    await expect(createRuntimePool(url('ops_monitor'), 'domain')).rejects.toThrow(
      'Nie można uruchomić ograniczonej puli połączeń.');
  });
});

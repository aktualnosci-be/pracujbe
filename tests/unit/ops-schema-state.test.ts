// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import config from '../../next.config.mjs';
import { expectedSchemaMigration } from '../../scripts/db/expected-migration.mjs';
import {
  expectedMigrationFromEnv,
  isMigrationBehind,
  parseSchemaState,
  schemaAlerts,
  schemaSummary,
  type SchemaStateResult,
} from '@/lib/ops/schema-state';

/**
 * #1065 — czujka zgodności schematu bazy z wdrożonym kodem: build zapisuje najwyższą migrację,
 * `ops_schema_state()` (0184) zwraca zastosowaną, `/api/health/ops` porównuje i alarmuje
 * `schema_behind_code`. Dowód po stronie SQL: `rls.sql` sekcja SS1065.
 */

const EXPECTED = '0184_job_draft_cas_schema_state.sql';
const ok = (latest: string | null, applied = 10): SchemaStateResult => ({ kind: 'ok', state: { applied, latest } });

describe('expectedSchemaMigration (build)', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'expected-migration-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function seed(dir: string, names: string[]): void {
    mkdirSync(join(root, dir), { recursive: true });
    for (const name of names) writeFileSync(join(root, dir, name), '-- x');
  }

  it('bierze najwyższą nazwę z migracji domeny i auth, ignorując pliki spoza wzorca', () => {
    seed('supabase/migrations', ['0001_a.sql', '0176_b.sql', 'README.md', '9999_Zla-Nazwa.sql']);
    seed('database/auth', ['0002_auth.sql', '0177_auth_later.sql']);
    expect(expectedSchemaMigration(root)).toBe('0177_auth_later.sql');
  });

  it('brak katalogów albo migracji = null (czujka wyłączona, build się nie wywraca)', () => {
    expect(expectedSchemaMigration(root)).toBeNull();
    seed('supabase/migrations', ['notes.txt']);
    expect(expectedSchemaMigration(root)).toBeNull();
  });

  it('dla repozytorium zwraca dokładnie najwyższy plik migracji (ta sama lista co migrator)', () => {
    const names = [
      ...readdirSync(join(process.cwd(), 'supabase/migrations')),
      ...readdirSync(join(process.cwd(), 'database/auth')),
    ].filter((n) => /^\d{4}_[a-z0-9_]+\.sql$/.test(n));
    expect(expectedSchemaMigration()).toBe([...names].sort().at(-1));
  });

  it('next.config.mjs wbudowuje ją w artefakt jako PRACUJBE_EXPECTED_MIGRATION', () => {
    const value = (config.env as Record<string, string>).PRACUJBE_EXPECTED_MIGRATION;
    expect(value).toBe(expectedSchemaMigration());
    expect(value).toMatch(/^\d{4}_[a-z0-9_]+\.sql$/);
  });
});

describe('schemaAlerts', () => {
  it('baza zgodna z kodem albo nowsza (rollback wdrożenia) → bez alarmu', () => {
    expect(schemaAlerts(EXPECTED, ok(EXPECTED))).toEqual([]);
    expect(schemaAlerts(EXPECTED, ok('0965_nowsza.sql'))).toEqual([]);
  });

  it('kontrola ujemna: baza za kodem → schema_behind_code', () => {
    expect(schemaAlerts(EXPECTED, ok('0176_classifieds_ai_billing.sql'))).toEqual(['schema_behind_code']);
    expect(schemaAlerts(EXPECTED, ok(null, 0))).toEqual(['schema_behind_code']);
  });

  it('brak funkcji ops_schema_state (baza sprzed 0184) = baza za kodem', () => {
    expect(schemaAlerts(EXPECTED, { kind: 'missing' })).toEqual(['schema_behind_code']);
  });

  it('błąd odczytu → schema_state_unreadable, nigdy „zgodne”', () => {
    expect(schemaAlerts(EXPECTED, { kind: 'error' })).toEqual(['schema_state_unreadable']);
  });

  it('build bez informacji o migracjach albo brak źródła metryk → nic nie porównujemy', () => {
    expect(schemaAlerts(null, ok('0001_a.sql'))).toEqual([]);
    expect(schemaAlerts(null, { kind: 'missing' })).toEqual([]);
    expect(schemaAlerts(EXPECTED, { kind: 'unconfigured' })).toEqual([]);
  });

  it('porządek wg numeru migracji, nie długości nazwy', () => {
    expect(isMigrationBehind('0099_z_bardzo_dluga_nazwa.sql', '0100_a.sql')).toBe(true);
    expect(isMigrationBehind('0100_a.sql', '0100_inna_nazwa.sql')).toBe(false);
  });
});

describe('schemaSummary / parseSchemaState / env', () => {
  it('podsumowanie niesie tylko nazwy migracji i status', () => {
    expect(schemaSummary(EXPECTED, ok('0176_x.sql', 176))).toEqual({
      expected: EXPECTED, latest: '0176_x.sql', applied: 176, status: 'behind',
    });
    expect(schemaSummary(EXPECTED, ok(EXPECTED, 177)).status).toBe('ok');
    expect(schemaSummary(EXPECTED, { kind: 'error' }).status).toBe('unreadable');
    expect(schemaSummary(null, { kind: 'unconfigured' }).status).toBe('skipped');
  });

  it('parseSchemaState przyjmuje wyłącznie kształt z ops_schema_state()', () => {
    expect(parseSchemaState({ applied: 3, latest: '0001_a.sql' })).toEqual({ applied: 3, latest: '0001_a.sql' });
    expect(parseSchemaState({ applied: 0, latest: null })).toEqual({ applied: 0, latest: null });
    expect(parseSchemaState({ applied: -1, latest: null })).toBeNull();
    expect(parseSchemaState('0001_a.sql')).toBeNull();
    expect(parseSchemaState(null)).toBeNull();
  });

  it('expectedMigrationFromEnv: pusta albo nieprawidłowa wartość = wyłączona', () => {
    expect(expectedMigrationFromEnv({ PRACUJBE_EXPECTED_MIGRATION: EXPECTED })).toBe(EXPECTED);
    for (const value of ['', '  ', 'nie-migracja', '0184_Zle.sql', undefined]) {
      expect(expectedMigrationFromEnv({ PRACUJBE_EXPECTED_MIGRATION: value })).toBeNull();
    }
  });
});

describe('GET /api/health/ops — schema_behind_code (#1065)', () => {
  const readOpsMetrics = vi.fn();
  const readSchemaState = vi.fn();
  const readBackupFreshness = vi.fn();
  const SECRET = 'ops-token-0123456789abcdef';
  const metrics = {
    email: { ready: 1, oldestReadyAgeSeconds: 30, abandonedLeases: 0, failedLast24h: 0 },
    authEmail: null,
    webhooks: { stuckProcessing: 0, failedLast24h: 0 },
    maintenance: { overdueActiveJobs: 0, staleDiscountReservations: 0, staleCheckoutIntents: 0 },
    connections: { used: 4, max: 100, reserved: 3 },
  };
  let GET: (request: Request) => Promise<Response>;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('@/lib/ops/metrics-source', () => ({
      readOpsMetrics: () => readOpsMetrics(),
      readSchemaState: () => readSchemaState(),
    }));
    vi.doMock('@/lib/db/runtime', () => ({ domainPoolStats: () => null }));
    vi.doMock('@/lib/ops/backup-freshness', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@/lib/ops/backup-freshness')>()),
      readBackupFreshness: () => readBackupFreshness(),
    }));
    readOpsMetrics.mockReset().mockResolvedValue({ kind: 'ok', metrics });
    readSchemaState.mockReset();
    readBackupFreshness.mockReset().mockResolvedValue({ status: 'ok', ageSeconds: 60, lastBackupAt: '2026-09-25T03:00:00.000Z' });
    vi.stubEnv('HEALTH_CHECK_SECRET', SECRET);
    vi.stubEnv('PRACUJBE_EXPECTED_MIGRATION', EXPECTED);
    ({ GET } = await import('@/app/api/health/ops/route'));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock('@/lib/ops/metrics-source');
    vi.doUnmock('@/lib/db/runtime');
    vi.doUnmock('@/lib/ops/backup-freshness');
  });

  const call = () => GET(new Request('https://pracuj.be/api/health/ops', { headers: { 'x-health-token': SECRET } }));

  it('baza zgodna z kodem → 200 i opis schematu', async () => {
    readSchemaState.mockResolvedValue(ok(EXPECTED, 177));
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      status: 'ok', alerts: [], schema: { expected: EXPECTED, latest: EXPECTED, applied: 177, status: 'ok' },
    });
  });

  it('kontrola ujemna: baza za kodem → 503 alert schema_behind_code', async () => {
    readSchemaState.mockResolvedValue(ok('0176_classifieds_ai_billing.sql', 176));
    const res = await call();
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      status: 'alert', alerts: ['schema_behind_code'], schema: { status: 'behind', latest: '0176_classifieds_ai_billing.sql' },
    });
  });

  it('baza bez funkcji ops_schema_state → 503 schema_behind_code', async () => {
    readSchemaState.mockResolvedValue({ kind: 'missing' });
    const res = await call();
    expect(res.status).toBe(503);
    expect((await res.json()).alerts).toEqual(['schema_behind_code']);
  });

  it('build bez oczekiwanej migracji nie czyta stanu schematu', async () => {
    vi.stubEnv('PRACUJBE_EXPECTED_MIGRATION', '');
    const res = await call();
    expect(res.status).toBe(200);
    expect(readSchemaState).not.toHaveBeenCalled();
    expect((await res.json()).schema).toMatchObject({ expected: null, status: 'skipped' });
  });
});

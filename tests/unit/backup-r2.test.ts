// @vitest-environment node
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BACKUP_MAX_AGE_SECONDS, backupAlerts, readBackupFreshness } from '@/lib/ops/backup-freshness';

import {
  backupS3Config,
  createBackupS3Client,
  downloadBackup,
  latestComplete,
  listBackupNames,
  pruneBackups,
  retentionPlan,
  uploadFiles,
} from '../../scripts/db/lib/backup-s3.mjs';
import { createFakeS3 } from '../helpers/fake-s3-server.mjs';

/**
 * #569 — kopia bazy w prywatnym buckecie Cloudflare R2 (API S3). Atrapa S3 rozróżnia klucz
 * zapisu i odczytu (odczyt nie może PUT/DELETE), więc testy pokazują też kontrolę ujemną.
 */
const WRITE = { id: 'backup-write-id', secret: 'backup-write-secret' };
const READ = { id: 'backup-read-id', secret: 'backup-read-secret' };
const fake = createFakeS3({ bucket: 'pracujbe-backups', writeKeys: [WRITE.id], readKeys: [READ.id] });
let endpoint = '';

function env(extra: Record<string, string> = {}): Record<string, string> {
  return {
    BACKUP_S3_ENDPOINT: endpoint,
    BACKUP_S3_BUCKET: 'pracujbe-backups',
    BACKUP_S3_PREFIX: 'prod',
    BACKUP_S3_ALLOW_INSECURE_LOCAL: '1',
    ...extra,
  };
}
const writeEnv = () => env({ BACKUP_S3_ACCESS_KEY_ID: WRITE.id, BACKUP_S3_SECRET_ACCESS_KEY: WRITE.secret });
const readEnv = () => env({ BACKUP_S3_READ_ACCESS_KEY_ID: READ.id, BACKUP_S3_READ_SECRET_ACCESS_KEY: READ.secret });

function cfg(values: Record<string, string>, mode: 'write' | 'read') {
  const result = backupS3Config(values, mode);
  if (!result.ok) throw new Error(result.message);
  return result.config;
}

function copy(dir: string, stamp: string): string[] {
  const artifact = join(dir, `pracujbe-${stamp}.dump.age`);
  const manifest = join(dir, `pracujbe-${stamp}.json`);
  writeFileSync(artifact, `age-encryption.org/v1 ${stamp}`);
  writeFileSync(manifest, JSON.stringify({ format: 'pracujbe-backup/1', artifact: `pracujbe-${stamp}.dump.age` }));
  return [artifact, manifest];
}

beforeAll(async () => {
  endpoint = await fake.listen();
});
afterAll(() => fake.close());

describe('konfiguracja BACKUP_S3_*', () => {
  it('brak zmiennych = unconfigured; niepełna albo http = invalid', () => {
    expect(backupS3Config({}, 'write')).toMatchObject({ ok: false, reason: 'unconfigured' });
    expect(backupS3Config({ BACKUP_S3_BUCKET: 'b-1' }, 'write')).toMatchObject({ ok: false, reason: 'invalid' });
    const httpEnv = { ...writeEnv(), BACKUP_S3_ALLOW_INSECURE_LOCAL: '' };
    expect(backupS3Config(httpEnv, 'write')).toMatchObject({ ok: false, reason: 'invalid' });
    const r2 = {
      ...writeEnv(),
      BACKUP_S3_ENDPOINT: 'https://0123456789abcdef.r2.cloudflarestorage.com',
      BACKUP_S3_ALLOW_INSECURE_LOCAL: '',
    };
    expect(cfg(r2, 'write')).toMatchObject({ region: 'auto', prefix: 'prod/', bucket: 'pracujbe-backups' });
    expect(backupS3Config({ ...r2, BACKUP_S3_ENDPOINT: `${r2.BACKUP_S3_ENDPOINT}/bucket` }, 'write').ok).toBe(false);
  });

  it('nie miesza się z bucketem plików CV (AWS_*)', () => {
    const same = { ...writeEnv(), AWS_S3_BUCKET_NAME: 'pracujbe-backups', AWS_ENDPOINT_URL: endpoint };
    expect(backupS3Config(same, 'write')).toMatchObject({ ok: false, reason: 'invalid' });
    const sameKey = { ...writeEnv(), AWS_ACCESS_KEY_ID: WRITE.id };
    expect(backupS3Config(sameKey, 'write')).toMatchObject({ ok: false, reason: 'invalid' });
    // Kontrola ujemna: inny bucket CV = poprawna konfiguracja.
    expect(backupS3Config({ ...writeEnv(), AWS_S3_BUCKET_NAME: 'candidate-files', AWS_ACCESS_KEY_ID: 'cv-key' }, 'write').ok).toBe(true);
  });

  it('tryb odczytu bierze wyłącznie klucz odczytu', () => {
    expect(backupS3Config(writeEnv(), 'read')).toMatchObject({ ok: false, reason: 'invalid' });
    expect(cfg(readEnv(), 'read').accessKeyId).toBe(READ.id);
  });
});

describe('retencja', () => {
  const names = [
    'pracujbe-20260920T030000Z.dump.age', 'pracujbe-20260920T030000Z.json',
    'pracujbe-20260921T030000Z.dump.age', 'pracujbe-20260921T030000Z.json',
    'pracujbe-20260922T030000Z.dump.age', 'pracujbe-20260922T030000Z.json',
    // niekompletna (brak manifestu) — nie jest „najnowszą kopią”
    'pracujbe-20260923T030000Z.dump.age',
    'inny-plik.txt', 'pracujbe-latest.json',
  ];

  it('zostawia N najnowszych, usuwa tylko pliki o wzorcu kopii, najnowsza kompletna zostaje zawsze', () => {
    expect(latestComplete(names)?.stamp).toBe('20260922T030000Z');
    const plan = retentionPlan(names, { keep: 2 });
    expect(plan.sort()).toEqual([
      'pracujbe-20260920T030000Z.dump.age', 'pracujbe-20260920T030000Z.json',
      'pracujbe-20260921T030000Z.dump.age', 'pracujbe-20260921T030000Z.json',
    ]);
    expect(plan).not.toContain('inny-plik.txt');
    // Wiek: starsze niż 2 dni od 23.09 12:00 idą, najnowsza kompletna zostaje mimo keep=1.
    const byAge = retentionPlan(names, { keep: 10, maxAgeDays: 2, now: new Date('2026-09-23T12:00:00Z') });
    expect(byAge).toContain('pracujbe-20260920T030000Z.json');
    expect(byAge).not.toContain('pracujbe-20260922T030000Z.dump.age');
    expect(retentionPlan(names, { keep: 1 })).not.toContain('pracujbe-20260922T030000Z.json');
  });
});

describe('wysyłka, retencja i pobranie przez API S3 (atrapa R2)', () => {
  it('klucz zapisu wysyła i przycina; klucz odczytu pobiera, ale nie może zapisać', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pracujbe-r2-'));
    const writer = await createBackupS3Client(cfg(writeEnv(), 'write'));
    const reader = await createBackupS3Client(cfg(readEnv(), 'read'));
    try {
      for (const stamp of ['20260920T030000Z', '20260921T030000Z', '20260922T030000Z']) {
        await uploadFiles(writer, cfg(writeEnv(), 'write'), copy(dir, stamp));
      }
      expect([...fake.objects.keys()].every((k) => k.startsWith('prod/'))).toBe(true);
      const prune = await pruneBackups(writer, cfg(writeEnv(), 'write'), { keep: 2 });
      expect(prune).toEqual({ removed: 1, kept: 2 });
      const names = await listBackupNames(reader, cfg(readEnv(), 'read'));
      expect(names.sort()).toEqual([
        'pracujbe-20260921T030000Z.dump.age', 'pracujbe-20260921T030000Z.json',
        'pracujbe-20260922T030000Z.dump.age', 'pracujbe-20260922T030000Z.json',
      ]);

      const out = mkdtempSync(join(tmpdir(), 'pracujbe-r2-dl-'));
      await downloadBackup(reader, cfg(readEnv(), 'read'), 'pracujbe-20260922T030000Z.dump.age', out);
      expect(readFileSync(join(out, 'pracujbe-20260922T030000Z.dump.age'), 'utf8')).toContain('20260922T030000Z');
      expect(readFileSync(join(out, 'pracujbe-20260922T030000Z.json'), 'utf8')).toContain('pracujbe-backup/1');

      // Kontrola ujemna: klucz odczytu (aplikacja) nie zapisze ani nie usunie kopii.
      await expect(uploadFiles(reader, cfg(readEnv(), 'read'), copy(dir, '20260923T030000Z'))).rejects.toThrow();
      await expect(pruneBackups(reader, cfg(readEnv(), 'read'), { keep: 1 })).rejects.toThrow();
      expect(fake.objects.has('prod/pracujbe-20260923T030000Z.dump.age')).toBe(false);
      expect(fake.objects.has('prod/pracujbe-20260921T030000Z.json')).toBe(true);
    } finally {
      writer.destroy();
      reader.destroy();
    }
  });
});

describe('czujka wieku kopii (/api/health/ops)', () => {
  it('brak konfiguracji → unconfigured + alarm (nie „OK”)', async () => {
    const result = await readBackupFreshness({ env: {} });
    expect(result).toEqual({ status: 'unconfigured' });
    expect(backupAlerts(result)).toEqual(['backup_unconfigured']);
  });

  it('klucz zapisu w usłudze web → misconfigured', async () => {
    const result = await readBackupFreshness({ env: { ...readEnv(), BACKUP_S3_SECRET_ACCESS_KEY: 'x' } });
    expect(result).toEqual({ status: 'misconfigured' });
    expect(backupAlerts(result)).toEqual(['backup_misconfigured']);
  });

  it('świeża kopia z atrapy R2 → ok; stara → stale; pusty prefiks → missing; awaria → unavailable', async () => {
    const at = new Date('2026-09-22T03:00:00Z');
    const fresh = await readBackupFreshness({ env: readEnv(), now: () => new Date(at.getTime() + 3600_000) });
    expect(fresh).toEqual({ status: 'ok', ageSeconds: 3600, lastBackupAt: at.toISOString() });
    expect(backupAlerts(fresh)).toEqual([]);

    const stale = await readBackupFreshness({
      env: readEnv(),
      now: () => new Date(at.getTime() + (BACKUP_MAX_AGE_SECONDS + 1) * 1000),
    });
    expect(stale.status).toBe('stale');
    expect(backupAlerts(stale)).toEqual(['backup_stale']);

    expect(await readBackupFreshness({ env: { ...readEnv(), BACKUP_S3_PREFIX: 'empty' } })).toEqual({ status: 'missing' });
    const down = await readBackupFreshness({ env: readEnv(), listNames: async () => { throw new Error(`fail ${endpoint}`); } });
    expect(down).toEqual({ status: 'unavailable' });
    expect(JSON.stringify(down)).not.toContain(endpoint);
  });
});

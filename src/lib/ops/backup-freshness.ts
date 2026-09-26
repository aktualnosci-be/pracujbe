import 'server-only';

import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';

import { isProductionMode } from '@/lib/env';

import { backupS3Config, latestComplete, stampDate } from '../../../scripts/db/lib/backup-s3-core.mjs';

/**
 * Czujka wieku ostatniej kopii bazy w buckecie Cloudflare R2 (#569) dla `/api/health/ops`.
 *
 * Aplikacja zna WYŁĄCZNIE klucz odczytu (`BACKUP_S3_READ_*`); klucz zapisu ma tylko zadanie
 * kopii (`scripts/db/backup.sh`). Klucz zapisu w usłudze web = błędna konfiguracja (alarm).
 * Brak konfiguracji to „nie skonfigurowano” — nigdy „OK”. Odpowiedź: sam stan, wiek w
 * sekundach i czas kopii — bez nazwy bucketu, endpointu i kluczy.
 */

/** Kopia raz na dobę + zapas na opóźnienie crona. */
export const BACKUP_MAX_AGE_SECONDS = 26 * 60 * 60;
const TIMEOUT_MS = 4000;

export type BackupSignal = 'backup_unconfigured' | 'backup_misconfigured' | 'backup_unavailable' | 'backup_missing' | 'backup_stale';

export type BackupFreshness =
  | { status: 'unconfigured' | 'misconfigured' | 'unavailable' | 'missing' }
  | { status: 'ok' | 'stale'; ageSeconds: number; lastBackupAt: string };

export interface BackupFreshnessDeps {
  env?: Record<string, string | undefined>;
  now?: () => Date;
  /** Lista nazw obiektów pod prefiksem (bez prefiksu) — w testach bez sieci. */
  listNames?: () => Promise<string[]>;
}

async function listWithSdk(config: {
  endpoint: string;
  bucket: string;
  region: string;
  prefix: string;
  accessKeyId: string;
  secretAccessKey: string;
}): Promise<string[]> {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: true,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    maxAttempts: 1,
  });
  try {
    const names: string[] = [];
    let token: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const out = await client.send(
        new ListObjectsV2Command({ Bucket: config.bucket, Prefix: config.prefix, ContinuationToken: token, MaxKeys: 1000 }),
        { abortSignal: AbortSignal.timeout(TIMEOUT_MS) },
      );
      for (const item of out.Contents ?? []) {
        if (item.Key?.startsWith(config.prefix)) names.push(item.Key.slice(config.prefix.length));
      }
      if (!out.IsTruncated || !out.NextContinuationToken) return names;
      token = out.NextContinuationToken;
    }
    return names;
  } finally {
    client.destroy();
  }
}

export async function readBackupFreshness(deps: BackupFreshnessDeps = {}): Promise<BackupFreshness> {
  const env = deps.env ?? process.env;
  if (env.BACKUP_S3_ACCESS_KEY_ID?.trim() || env.BACKUP_S3_SECRET_ACCESS_KEY?.trim()) {
    return { status: 'misconfigured' };
  }
  // Lokalny endpoint http tylko w testach, nigdy w produkcji.
  const effectiveEnv = isProductionMode() ? { ...env, BACKUP_S3_ALLOW_INSECURE_LOCAL: undefined } : env;
  const cfg = backupS3Config(effectiveEnv, 'read');
  if (!cfg.ok) return { status: cfg.reason === 'unconfigured' ? 'unconfigured' : 'misconfigured' };

  let names: string[];
  try {
    names = await (deps.listNames ?? (() => listWithSdk(cfg.config)))();
  } catch {
    // Treść błędu SDK może zawierać endpoint i bucket — nie wychodzi poza moduł.
    return { status: 'unavailable' };
  }
  const latest = latestComplete(names);
  const at = latest ? stampDate(latest.stamp) : null;
  if (!latest || !at) return { status: 'missing' };
  const now = (deps.now ?? (() => new Date()))();
  const ageSeconds = Math.max(0, Math.floor((now.getTime() - at.getTime()) / 1000));
  return {
    status: ageSeconds > BACKUP_MAX_AGE_SECONDS ? 'stale' : 'ok',
    ageSeconds,
    lastBackupAt: at.toISOString(),
  };
}

/** Każdy stan poza `ok` to alarm — także brak konfiguracji (kopia poza Railwayem jest wymagana). */
export function backupAlerts(freshness: BackupFreshness): BackupSignal[] {
  switch (freshness.status) {
    case 'ok':
      return [];
    case 'stale':
      return ['backup_stale'];
    case 'missing':
      return ['backup_missing'];
    case 'unavailable':
      return ['backup_unavailable'];
    case 'misconfigured':
      return ['backup_misconfigured'];
    default:
      return ['backup_unconfigured'];
  }
}

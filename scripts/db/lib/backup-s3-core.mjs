// Czysta logika kopii w R2 (#569): konfiguracja BACKUP_S3_*, nazwy kopii, retencja.
// Bez I/O — używana przez CLI (scripts/db/lib/backup-s3.mjs) i czujkę aplikacji
// (src/lib/ops/backup-freshness.ts), więc obie strony liczą to samo.

export const ARTIFACT_RE = /^pracujbe-(\d{8}T\d{6}Z)\.dump\.age$/;
export const MANIFEST_RE = /^pracujbe-(\d{8}T\d{6}Z)\.json$/;
const BUCKET_RE = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const PREFIX_RE = /^[A-Za-z0-9._/-]{0,200}$/;

/** @typedef {'write' | 'read'} BackupS3Mode */
/**
 * @typedef {{ endpoint: string, bucket: string, region: string, prefix: string,
 *   accessKeyId: string, secretAccessKey: string }} BackupS3Config
 * @typedef {{ ok: true, config: BackupS3Config } | { ok: false, reason: 'unconfigured' | 'invalid', message: string }} BackupS3ConfigResult
 */

function trim(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Konfiguracja z env dla trybu zapisu (zadanie kopii) albo odczytu (aplikacja/odtworzenie).
 * @param {Record<string, string | undefined>} env
 * @param {BackupS3Mode} mode
 * @returns {BackupS3ConfigResult}
 */
export function backupS3Config(env, mode) {
  const endpoint = trim(env.BACKUP_S3_ENDPOINT);
  const bucket = trim(env.BACKUP_S3_BUCKET);
  const idName = mode === 'write' ? 'BACKUP_S3_ACCESS_KEY_ID' : 'BACKUP_S3_READ_ACCESS_KEY_ID';
  const secretName = mode === 'write' ? 'BACKUP_S3_SECRET_ACCESS_KEY' : 'BACKUP_S3_READ_SECRET_ACCESS_KEY';
  const accessKeyId = trim(env[idName]);
  const secretAccessKey = trim(env[secretName]);
  const anySet = [endpoint, bucket, accessKeyId, secretAccessKey].some(Boolean);
  if (!anySet) return { ok: false, reason: 'unconfigured', message: 'Brak konfiguracji BACKUP_S3_*.' };
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    return { ok: false, reason: 'invalid', message: `Niepełna konfiguracja: BACKUP_S3_ENDPOINT, BACKUP_S3_BUCKET, ${idName}, ${secretName}.` };
  }
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    return { ok: false, reason: 'invalid', message: 'BACKUP_S3_ENDPOINT nie jest adresem URL.' };
  }
  const localTest =
    env.BACKUP_S3_ALLOW_INSECURE_LOCAL === '1' && url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname);
  if (url.protocol !== 'https:' && !localTest) {
    return { ok: false, reason: 'invalid', message: 'BACKUP_S3_ENDPOINT musi używać https.' };
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    return { ok: false, reason: 'invalid', message: 'BACKUP_S3_ENDPOINT: sam origin, bez ścieżki i parametrów.' };
  }
  if (!BUCKET_RE.test(bucket)) return { ok: false, reason: 'invalid', message: 'Nieprawidłowa nazwa BACKUP_S3_BUCKET.' };
  let prefix = trim(env.BACKUP_S3_PREFIX);
  if (!PREFIX_RE.test(prefix) || prefix.includes('..') || prefix.startsWith('/')) {
    return { ok: false, reason: 'invalid', message: 'Nieprawidłowy BACKUP_S3_PREFIX.' };
  }
  if (prefix && !prefix.endsWith('/')) prefix += '/';

  // Nie mieszać z bucketem plików CV (AWS_* — #26).
  const cvBucket = trim(env.AWS_S3_BUCKET_NAME);
  let cvHost = '';
  try {
    cvHost = env.AWS_ENDPOINT_URL ? new URL(trim(env.AWS_ENDPOINT_URL)).host : '';
  } catch {
    cvHost = '';
  }
  if ((cvBucket && cvBucket === bucket && (!cvHost || cvHost === url.host)) || accessKeyId === trim(env.AWS_ACCESS_KEY_ID)) {
    return { ok: false, reason: 'invalid', message: 'BACKUP_S3_* wskazuje bucket lub klucz plików CV (AWS_*) — użyj osobnego bucketu R2.' };
  }
  return {
    ok: true,
    config: { endpoint: url.origin, bucket, region: trim(env.BACKUP_S3_REGION) || 'auto', prefix, accessKeyId, secretAccessKey },
  };
}

/** Znacznik czasu kopii (`YYYYMMDDTHHMMSSZ`) → Date. */
export function stampDate(stamp) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(stamp);
  if (!m) return null;
  const date = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Kopie w buckecie wg znacznika (najnowsze pierwsze). Kompletna = artefakt + manifest.
 * @param {string[]} names nazwy obiektów bez prefiksu
 */
export function groupBackups(names) {
  /** @type {Map<string, { stamp: string, artifact: boolean, manifest: boolean }>} */
  const byStamp = new Map();
  for (const name of names) {
    const a = ARTIFACT_RE.exec(name);
    const m = MANIFEST_RE.exec(name);
    const stamp = a?.[1] ?? m?.[1];
    if (!stamp || !stampDate(stamp)) continue;
    const entry = byStamp.get(stamp) ?? { stamp, artifact: false, manifest: false };
    if (a) entry.artifact = true;
    if (m) entry.manifest = true;
    byStamp.set(stamp, entry);
  }
  return [...byStamp.values()].sort((x, y) => (x.stamp < y.stamp ? 1 : x.stamp > y.stamp ? -1 : 0));
}

export function latestComplete(names) {
  return groupBackups(names).find((b) => b.artifact && b.manifest) ?? null;
}

/**
 * Plan retencji: zostaje `keep` najnowszych kopii; starsze niż `maxAgeDays` też są usuwane.
 * Najnowsza kompletna kopia zostaje zawsze. Tylko nazwy o dokładnym wzorcu.
 * @param {string[]} names
 * @param {{ keep: number, maxAgeDays?: number | null, now?: Date }} options
 * @returns {string[]} nazwy obiektów do usunięcia
 */
export function retentionPlan(names, { keep, maxAgeDays, now = new Date() }) {
  const groups = groupBackups(names);
  const newest = latestComplete(names)?.stamp;
  const limit = maxAgeDays ? now.getTime() - maxAgeDays * 86_400_000 : null;
  const doomed = [];
  groups.forEach((group, index) => {
    if (group.stamp === newest) return;
    const tooMany = index >= keep;
    const tooOld = limit !== null && (stampDate(group.stamp)?.getTime() ?? 0) < limit;
    if (!tooMany && !tooOld) return;
    if (group.artifact) doomed.push(`pracujbe-${group.stamp}.dump.age`);
    if (group.manifest) doomed.push(`pracujbe-${group.stamp}.json`);
  });
  return doomed;
}


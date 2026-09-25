#!/usr/bin/env node
// =============================================================================
// scripts/db/lib/backup-s3.mjs — kopie bazy w prywatnym buckecie Cloudflare R2 (#569).
//
// API S3 (endpoint R2, region `auto`, styl ścieżki). Osobne zmienne BACKUP_S3_* — nigdy
// AWS_* bucketu CV (#26): skrypt odmawia, gdy wskazują ten sam bucket albo klucz.
//   BACKUP_S3_ENDPOINT              https://<konto>.r2.cloudflarestorage.com
//   BACKUP_S3_BUCKET                nazwa prywatnego bucketu (bez domeny publicznej i r2.dev)
//   BACKUP_S3_REGION                domyślnie `auto`
//   BACKUP_S3_PREFIX                opcjonalny katalog w buckecie (np. `pracujbe/`)
//   BACKUP_S3_ACCESS_KEY_ID / _SECRET_ACCESS_KEY            klucz ZAPISU (tylko zadanie kopii)
//   BACKUP_S3_READ_ACCESS_KEY_ID / _READ_SECRET_ACCESS_KEY  klucz ODCZYTU (aplikacja, odtworzenie)
//   BACKUP_S3_MAX_AGE_DAYS          opcjonalnie: usuń kopie starsze niż N dni (najnowsza zostaje)
//
// Polecenia (kod wyjścia: 0 ok, 1 błąd operacji, 2 zła konfiguracja/argumenty):
//   upload <plik>...          wysyła pliki (artefakt, potem manifest) i sprawdza rozmiar (zapis)
//   prune <liczba>            zostawia <liczba> najnowszych kopii (+ BACKUP_S3_MAX_AGE_DAYS) (zapis)
//   latest                    wypisuje nazwę najnowszego kompletnego artefaktu (odczyt)
//   download <nazwa> <kat>    pobiera artefakt i manifest do katalogu (odczyt)
//   list                      wypisuje nazwy kopii w buckecie (odczyt)
//   check <write|read>        tylko walidacja konfiguracji, bez połączenia
// Nie wypisuje kluczy, endpointu ani treści obiektów.
// =============================================================================
import { createReadStream, createWriteStream, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pipeline } from 'node:stream/promises';

import {
  ARTIFACT_RE,
  MANIFEST_RE,
  backupS3Config,
  groupBackups,
  latestComplete,
  retentionPlan,
} from './backup-s3-core.mjs';

export { ARTIFACT_RE, MANIFEST_RE, backupS3Config, groupBackups, latestComplete, retentionPlan };

/** @typedef {import('./backup-s3-core.mjs').BackupS3Config} BackupS3Config */

function trim(value) {
  return typeof value === 'string' ? value.trim() : '';
}

async function sdk() {
  return import('@aws-sdk/client-s3');
}

/** @param {BackupS3Config} config */
export async function createBackupS3Client(config) {
  const { S3Client } = await sdk();
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: true,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    // R2: bez sum trailer/aws-chunked; integralność pilnuje SHA-256 z manifestu.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    maxAttempts: 3,
  });
}

/** @param {BackupS3Config} config */
export async function listBackupNames(client, config) {
  const { ListObjectsV2Command } = await sdk();
  const names = [];
  let token;
  for (let page = 0; page < 20; page += 1) {
    const out = await client.send(
      new ListObjectsV2Command({ Bucket: config.bucket, Prefix: config.prefix, ContinuationToken: token, MaxKeys: 1000 }),
    );
    for (const item of out.Contents ?? []) {
      if (item.Key?.startsWith(config.prefix)) names.push(item.Key.slice(config.prefix.length));
    }
    if (!out.IsTruncated || !out.NextContinuationToken) return names;
    token = out.NextContinuationToken;
  }
  throw new Error('LIST_TOO_LONG');
}

/** @param {BackupS3Config} config */
export async function uploadFiles(client, config, files) {
  const { PutObjectCommand, HeadObjectCommand } = await sdk();
  for (const file of files) {
    const name = basename(file);
    if (!ARTIFACT_RE.test(name) && !MANIFEST_RE.test(name)) throw new Error('UNEXPECTED_NAME');
    const size = statSync(file).size;
    await client.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: config.prefix + name,
        Body: createReadStream(file),
        ContentLength: size,
        ContentType: name.endsWith('.json') ? 'application/json' : 'application/octet-stream',
      }),
    );
    const head = await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: config.prefix + name }));
    if (head.ContentLength !== size) throw new Error('SIZE_MISMATCH');
  }
}

/**
 * @param {import('@aws-sdk/client-s3').S3Client} client
 * @param {BackupS3Config} config
 * @param {{ keep: number, maxAgeDays?: number | null, now?: Date }} options
 */
export async function pruneBackups(client, config, { keep, maxAgeDays, now }) {
  const { DeleteObjectCommand } = await sdk();
  const names = await listBackupNames(client, config);
  const doomed = retentionPlan(names, { keep, maxAgeDays, now });
  for (const name of doomed) {
    await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: config.prefix + name }));
  }
  const removedCopies = new Set(doomed.map((n) => (ARTIFACT_RE.exec(n) ?? MANIFEST_RE.exec(n))?.[1])).size;
  return { removed: removedCopies, kept: groupBackups(names).length - removedCopies };
}

/** @param {BackupS3Config} config */
export async function downloadBackup(client, config, name, dir) {
  const { GetObjectCommand } = await sdk();
  const match = ARTIFACT_RE.exec(name);
  if (!match) throw new Error('UNEXPECTED_NAME');
  for (const object of [name, `pracujbe-${match[1]}.json`]) {
    const out = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: config.prefix + object }));
    if (!out.Body) throw new Error('EMPTY_BODY');
    await pipeline(out.Body, createWriteStream(join(dir, object), { mode: 0o600 }));
  }
}

async function main(argv) {
  const [command, ...args] = argv;
  const say = (msg) => console.log(`BACKUP_S3: ${msg}`);
  const die = (msg, code) => {
    console.error(`BACKUP_S3: ${msg}`);
    process.exit(code);
  };
  const mode =
    command === 'check'
      ? args[0] === 'write' || args[0] === 'read' ? args[0] : null
      : command === 'upload' || command === 'prune' ? 'write' : command === 'latest' || command === 'download' || command === 'list' ? 'read' : null;
  if (!mode) die('Nieznane polecenie (upload | prune | latest | list | download | check <write|read>).', 2);
  const cfg = backupS3Config(process.env, mode);
  if (!cfg.ok) die(cfg.message, 2);
  if (command === 'check') {
    say('konfiguracja poprawna.');
    return;
  }
  const client = await createBackupS3Client(cfg.config);
  try {
    if (command === 'upload') {
      if (!args.length) die('Podaj pliki.', 2);
      await uploadFiles(client, cfg.config, args);
      say(`wysłano ${args.length} plik(i).`);
    } else if (command === 'prune') {
      const keep = Number(args[0]);
      if (!Number.isInteger(keep) || keep < 1 || keep > 365) die('Retencja musi być liczbą 1–365.', 2);
      const rawAge = trim(process.env.BACKUP_S3_MAX_AGE_DAYS);
      const maxAgeDays = rawAge ? Number(rawAge) : null;
      if (maxAgeDays !== null && (!Number.isInteger(maxAgeDays) || maxAgeDays < 1 || maxAgeDays > 3650)) {
        die('BACKUP_S3_MAX_AGE_DAYS musi być liczbą 1–3650.', 2);
      }
      const { removed, kept } = await pruneBackups(client, cfg.config, { keep, maxAgeDays, now: new Date() });
      say(`retencja: zachowano ${kept}, usunięto ${removed}.`);
    } else if (command === 'list') {
      const names = (await listBackupNames(client, cfg.config)).filter((n) => ARTIFACT_RE.test(n) || MANIFEST_RE.test(n));
      for (const name of names.sort()) console.log(name);
    } else if (command === 'latest') {
      const latest = latestComplete(await listBackupNames(client, cfg.config));
      if (!latest) die('Brak kompletnej kopii w buckecie.', 1);
      console.log(`pracujbe-${latest.stamp}.dump.age`);
    } else {
      const [name, dir] = args;
      if (!name || !dir || !ARTIFACT_RE.test(name)) die('Użycie: download <pracujbe-….dump.age> <katalog>.', 2);
      await downloadBackup(client, cfg.config, name, dir);
      say('pobrano artefakt i manifest.');
    }
  } catch (error) {
    // Bez treści błędu SDK (może zawierać endpoint/bucket) — tylko nazwa/kod.
    const code = error && typeof error === 'object' && 'name' in error ? String(error.name) : 'Error';
    die(`operacja nie powiodła się (${code.replace(/[^A-Za-z0-9_]/g, '').slice(0, 60)}).`, 1);
  } finally {
    client.destroy();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main(process.argv.slice(2));
}

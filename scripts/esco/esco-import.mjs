/**
 * CLI importu przypiętego snapshotu ESCO v1.2.1 (#93). Opis: docs/ESCO.md.
 *
 *   manifest --dir D --out F                      przypięcie: SHA-256 + rozmiar pobranych plików
 *   verify   --dir D [--manifest F]               sumy + parsowanie + raport, bez bazy
 *   import   --dir D [--manifest F] [--dry-run] [--manual=fail|skip|overwrite] [--allow-sample]
 *            [--report R]                        ESCO_IMPORT_DATABASE_URL (login mogący SET ROLE service_role)
 *
 * Domyślny manifest: data/esco/esco-v1.2.1.manifest.json.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { MANUAL_POLICIES, importSnapshot } from './lib/import.mjs';
import { ESCO_VERSION, buildManifest, parseSnapshot, readVerifiedFiles, validateManifest } from './lib/snapshot.mjs';

export const DEFAULT_MANIFEST = `data/esco/esco-${ESCO_VERSION}.manifest.json`;

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { command, manual: 'fail', dryRun: false, allowSample: false };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    const [key, inline] = arg.split(/=(.*)/s, 2);
    const value = () => {
      if (inline !== undefined) return inline;
      const next = rest[++i];
      if (next === undefined) throw new Error(`Brak wartości dla ${key}.`);
      return next;
    };
    switch (key) {
      case '--dir': options.dir = value(); break;
      case '--manifest': options.manifest = value(); break;
      case '--out': options.out = value(); break;
      case '--report': options.report = value(); break;
      case '--snapshot': options.snapshot = value(); break;
      case '--manual': options.manual = value(); break;
      case '--dry-run': options.dryRun = true; break;
      case '--allow-sample': options.allowSample = true; break;
      default: throw new Error(`Nieznany argument: ${arg}.`);
    }
  }
  if (!['manifest', 'verify', 'import'].includes(command)) throw new Error('Użycie: esco-import.mjs manifest|verify|import --dir <katalog> …');
  if (!options.dir) throw new Error('Podaj --dir z rozpakowanymi plikami CSV ESCO.');
  if (!MANUAL_POLICIES.includes(options.manual)) throw new Error(`--manual: dozwolone ${MANUAL_POLICIES.join(', ')}.`);
  if (command === 'manifest' && !options.out) throw new Error('Podaj --out dla manifestu.');
  return options;
}

async function loadModel(options) {
  const manifest = validateManifest(JSON.parse(await readFile(resolve(options.manifest ?? DEFAULT_MANIFEST), 'utf8')));
  const files = await readVerifiedFiles(resolve(options.dir), manifest);
  return { manifest, model: parseSnapshot(files) };
}

/** Komunikat bez danych z bazy: własne błędy walidacji i kody ESCO_*; reszta ogólnie. */
export function safeMessage(error) {
  const message = String(error?.message ?? '');
  if (/^ESCO_[A-Z_]+$/.test(message)) return message + (error.detail ? ` — ${error.detail}` : '');
  if (error?.code === undefined && message) return message;
  return 'Import nie powiódł się. Sprawdź połączenie, uprawnienia (SET ROLE service_role) i migrację 0098.';
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(error.message);
    return 2;
  }
  try {
    if (options.command === 'manifest') {
      const snapshot = options.snapshot ?? `esco-${ESCO_VERSION}`;
      const manifest = await buildManifest(resolve(options.dir), { snapshot, sample: snapshot.endsWith('-sample') });
      await writeFile(resolve(options.out), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
      console.log(`Manifest zapisany (${Object.keys(manifest.files).length} plików). Zatwierdź go w repozytorium.`);
      return 0;
    }
    const { manifest, model } = await loadModel(options);
    if (options.command === 'verify') {
      const { missingTranslationUris, ...report } = model.report;
      if (options.report) await writeFile(resolve(options.report), `${JSON.stringify({ ...report, missingTranslationUris }, null, 2)}\n`);
      console.log(JSON.stringify({ snapshot: manifest.snapshot, ...report }, null, 2));
      return 0;
    }
    const connectionString = env.ESCO_IMPORT_DATABASE_URL;
    if (!connectionString) {
      console.error('Ustaw ESCO_IMPORT_DATABASE_URL (login z prawem SET ROLE service_role).');
      return 2;
    }
    const client = new pg.Client({ connectionString, connectionTimeoutMillis: 10_000 });
    await client.connect();
    try {
      const result = await importSnapshot(client, { manifest, model, manual: options.manual, dryRun: options.dryRun, allowSample: options.allowSample });
      const output = { ...result, missingTranslations: model.report.missingTranslations };
      if (options.report) await writeFile(resolve(options.report), `${JSON.stringify({ ...output, missingTranslationUris: model.report.missingTranslationUris }, null, 2)}\n`);
      console.log(JSON.stringify(output, null, 2));
      return 0;
    } finally {
      await client.end();
    }
  } catch (error) {
    console.error(safeMessage(error));
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main();
}

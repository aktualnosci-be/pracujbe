import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Wczytuje migracje bez wykonywania SQL. Suma jest identyczna na Windows i Linux.
 * @param {string} directory
 * @returns {Promise<Array<{name: string, sql: string, checksum: string}>>}
 */
export async function loadMigrations(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    throw new Error('Nie można odczytać katalogu migracji.');
  }

  const files = entries.filter(entry => /\.sql$/i.test(entry.name));
  if (!files.length) throw new Error('Katalog nie zawiera migracji SQL.');
  const prefixes = new Set();
  for (const entry of files) {
    if (!/^\d{4}_[a-z0-9_]+\.sql$/.test(entry.name)) {
      throw new Error('Nieprawidłowa nazwa migracji SQL.');
    }
    if (entry.isSymbolicLink() || !entry.isFile()) {
      throw new Error('Migracja SQL musi być zwykłym plikiem bez dowiązania.');
    }
    const prefix = entry.name.slice(0, 4);
    if (prefixes.has(prefix)) throw new Error('Powtórzony numer migracji SQL.');
    prefixes.add(prefix);
  }

  files.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const migrations = [];
  for (const entry of files) {
    let sql;
    try {
      sql = (await readFile(join(directory, entry.name), 'utf8')).replace(/\r\n/g, '\n');
    } catch {
      throw new Error('Nie można odczytać pliku migracji SQL.');
    }
    migrations.push({ name: entry.name, sql, checksum: createHash('sha256').update(sql, 'utf8').digest('hex') });
  }
  return migrations;
}

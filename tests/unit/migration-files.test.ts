// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadMigrations } from '../../scripts/db/migration-files.mjs';

let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'pracujbe-migrations-test-')); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe('Pliki migracji PostgreSQL', () => {
  it('zwraca posortowany SQL i sumy SHA-256, ignorując dokumentację', async () => {
    await writeFile(join(directory, '0002_second.sql'), 'SELECT 2;\n');
    await writeFile(join(directory, 'README.md'), 'Dokumentacja');
    await mkdir(join(directory, 'notes'));
    await writeFile(join(directory, '0001_first.sql'), 'SELECT 1;\n');
    const result = await loadMigrations(directory);
    expect(result).toEqual([1, 2].map(number => ({
      name: number === 1 ? '0001_first.sql' : '0002_second.sql',
      sql: `SELECT ${number};\n`,
      checksum: createHash('sha256').update(`SELECT ${number};\n`).digest('hex'),
    })));
  });

  it('normalizuje CRLF przed zwróceniem SQL i obliczeniem sumy', async () => {
    const file = join(directory, '0001_first.sql');
    await writeFile(file, 'SELECT 1;\r\nSELECT 2;\r\n');
    const windows = await loadMigrations(directory);
    await writeFile(file, 'SELECT 1;\nSELECT 2;\n');
    expect(windows).toEqual(await loadMigrations(directory));
  });

  it('odrzuca pusty katalog oraz katalog zawierający tylko dokumentację', async () => {
    await expect(loadMigrations(directory)).rejects.toThrow('Katalog nie zawiera migracji SQL.');
    await writeFile(join(directory, 'README.md'), 'Dokumentacja');
    await expect(loadMigrations(directory)).rejects.toThrow('Katalog nie zawiera migracji SQL.');
  });

  it.each(['1_first.sql', '00001_first.sql', '0001_First.sql', '0001_first.SQL', '0001_first-name.sql', '0001_.sql'])('odrzuca nieprawidłową nazwę %s', async name => {
    await writeFile(join(directory, name), 'SELECT 1;');
    await expect(loadMigrations(directory)).rejects.toThrow('Nieprawidłowa nazwa migracji SQL.');
  });

  it('odrzuca dwa pliki o tym samym numerze', async () => {
    await writeFile(join(directory, '0001_first.sql'), 'SELECT 1;');
    await writeFile(join(directory, '0001_second.sql'), 'SELECT 2;');
    await expect(loadMigrations(directory)).rejects.toThrow('Powtórzony numer migracji SQL.');
  });

  it('odrzuca dowiązanie SQL, także do zwykłego pliku', async context => {
    const target = join(directory, 'target.txt');
    await writeFile(target, 'SELECT 1;');
    try {
      await symlink(target, join(directory, '0001_link.sql'), 'file');
    } catch (error) {
      // Windows może wymagać trybu deweloperskiego. Linux CI wykonuje ten test.
      if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM') {
        context.skip();
        return;
      }
      throw error;
    }
    await expect(loadMigrations(directory)).rejects.toThrow('Migracja SQL musi być zwykłym plikiem bez dowiązania.');
  });

  it('odrzuca katalog udający plik SQL', async () => {
    await mkdir(join(directory, '0001_directory.sql'));
    await expect(loadMigrations(directory)).rejects.toThrow('Migracja SQL musi być zwykłym plikiem bez dowiązania.');
  });

  it('nie ujawnia ścieżki ani błędu systemowego', async () => {
    await expect(loadMigrations(join(directory, 'private-path'))).rejects.toThrow(/^Nie można odczytać katalogu migracji\.$/);
  });
});

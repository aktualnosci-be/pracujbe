#!/usr/bin/env node
// Ciągłość numeracji migracji produkcyjnych (#1246) — osobny krok jobu „Migration runner”.
//
// Operator loginów runtime (`scripts/db/runtime-logins.mjs`) wymaga ciągłego zakresu
// 0000..N. PR sesji potomnej z migracją na numerze TYMCZASOWYM (np. 0973 — procedura
// integratora, CLAUDE.md §0 pkt 7) ma lukę z definicji. Dawniej ta luka czerwieniła
// 4 testy `runtime-logins.test.ts` w kroku z CAŁĄ integracją, więc „czerwony = normalny”
// maskował prawdziwe regresje reszty kroku. Teraz luka ma własny krok z czytelnym
// komunikatem, a pozostałe testy integracyjne biegną i raportują osobno.
//
// Na main luka jest błędem (kod 1) — wykrywanie nie jest osłabione.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { loadProductionMigrations } from './production-migrations.mjs';
import { assertExpectedMigrations } from './runtime-logins.mjs';

/** Numery spoza ciągłego zakresu (np. tymczasowe 09xx) — do komunikatu. */
export function describeNumbering(migrations) {
  const expectedNext = migrations.findIndex((migration, index) => migration.name.slice(0, 4) !== String(index).padStart(4, '0'));
  if (expectedNext === -1) return null;
  return {
    expected: String(expectedNext).padStart(4, '0'),
    outOfRange: migrations.slice(expectedNext).map((migration) => migration.name),
  };
}

export async function main(loadMigrations = loadProductionMigrations) {
  const migrations = await loadMigrations();
  try {
    const range = assertExpectedMigrations(migrations);
    console.log(`Numeracja migracji ciągła: ${range} (${migrations.length} plików).`);
    return 0;
  } catch (error) {
    const gap = describeNumbering(migrations);
    console.error(error instanceof Error ? error.message : String(error));
    if (gap) {
      console.error(`Migracje od oczekiwanego numeru ${gap.expected}: ${gap.outOfRange.join(', ')}`);
    }
    console.error(
      'Numer tymczasowy w PR sesji potomnej = ten krok czerwony z założenia (ostateczny numer nadaje integrator). ' +
        'Na main luka numeracji to błąd. Pozostałe testy integracyjne mają osobny krok.',
    );
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main();
}

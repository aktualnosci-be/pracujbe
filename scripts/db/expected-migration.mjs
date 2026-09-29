import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Nazwa NAJWYŻSZEJ migracji, jaką zna ten build (#1065). To ta sama lista plików, którą nakłada
 * `production-migrations.mjs` (domena + auth; bootstrap ma numer 0000), więc `/api/health/ops`
 * może porównać ją z `public.ops_schema_state()` — baza za kodem = alarm `schema_behind_code`.
 * Tylko nazwy plików (bez czytania SQL), synchronicznie: woła ją `next.config.mjs` przy starcie builda.
 * Brak katalogów albo pliku pasującego do wzorca = `null` (czujka wyłączona, build się nie wywraca).
 *
 * @param {string} [root] katalog główny repozytorium
 * @returns {string | null}
 */
export function expectedSchemaMigration(root = fileURLToPath(new URL('../../', import.meta.url))) {
  let latest = null;
  for (const directory of ['supabase/migrations', 'database/auth']) {
    let entries;
    try {
      entries = readdirSync(resolve(root, directory));
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!/^\d{4}_[a-z0-9_]+\.sql$/.test(name)) continue;
      if (latest === null || name > latest) latest = name;
    }
  }
  return latest;
}

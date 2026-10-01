#!/usr/bin/env node
// =============================================================================
// scripts/db/confirm-age-policy.mjs — zatwierdzenie progu wieku kandydatów przez właściciela
// (#639, migracja 0946).
//
// Poza CI i poza panelem. Administrator zmienia próg w `/admin/ustawienia`, ale zapisuje tam
// wyłącznie wartość roboczą; status „zatwierdzone przez właściciela” nadaje tylko ten skrypt,
// jedyną drogą zapisu — RPC `owner_confirm_candidate_min_age` (EXECUTE tylko service_role,
// CAS po progu i znaczniku zmiany, notatka wymagana, audyt `age_policy.owner_confirmed`).
// Procedura: docs/railway/OPERATIONS.md („Próg wieku kandydatów”).
//
// Użycie (login migratora, nigdy DATABASE_URL aplikacji):
//   MIGRATION_DATABASE_URL=… node scripts/db/confirm-age-policy.mjs --status
//   MIGRATION_DATABASE_URL=… node scripts/db/confirm-age-policy.mjs \
//     --min-age 16 --expected "<znacznik z --status>" --note "…" --confirm 16
// `--confirm` musi powtórzyć zatwierdzany próg. Skrypt nie wypisuje URL-i.
// Kod wyjścia: 0 = OK, 1 = odmowa bazy (np. STALE_STATE), 2 = konfiguracja/argumenty.
// =============================================================================
import { pathToFileURL } from 'node:url';
import pg from 'pg';

export const AGE_BANDS = ['16', '18'];
export const NOTE_MAX = 1000;

/**
 * @param {string[]} argv
 * @returns {{ok: true, status: true} | {ok: true, status: false, minAge: number, expected: string, note: string}
 *   | {ok: false, error: string}}
 */
export function parseConfirmAgePolicyArgs(argv) {
  const values = {};
  let status = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--status') { status = true; continue; }
    const match = /^--(min-age|expected|note|confirm)(?:=(.*))?$/.exec(arg);
    if (!match) return { ok: false, error: `Nieznany argument: ${arg}` };
    const value = match[2] ?? argv[++i];
    if (value === undefined) return { ok: false, error: `Brak wartości dla --${match[1]}` };
    values[match[1]] = value;
  }
  if (status) {
    return Object.keys(values).length ? { ok: false, error: '--status nie łączy się z innymi argumentami' } : { ok: true, status: true };
  }
  const minAge = values['min-age'];
  const expected = (values.expected ?? '').trim();
  const note = (values.note ?? '').trim();
  if (!AGE_BANDS.includes(minAge ?? '')) return { ok: false, error: `--min-age: ${AGE_BANDS.join(' | ')}` };
  if (!expected) return { ok: false, error: '--expected: znacznik zmiany z --status' };
  if (!note || note.length > NOTE_MAX) return { ok: false, error: `--note: wymagane, 1–${NOTE_MAX} znaków` };
  if (values.confirm !== minAge) return { ok: false, error: '--confirm musi powtórzyć zatwierdzany próg (--min-age)' };
  return { ok: true, status: false, minAge: Number(minAge), expected, note };
}

async function main() {
  const parsed = parseConfirmAgePolicyArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(`AGE POLICY: ${parsed.error}`);
    return 2;
  }
  const connectionString = process.env.MIGRATION_DATABASE_URL;
  if (!connectionString) {
    console.error('AGE POLICY: ustaw MIGRATION_DATABASE_URL (login migratora).');
    return 2;
  }
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const read = async () => (await client.query(
      'SELECT candidate_min_age, confirmed, updated_at::text AS updated_at FROM public.age_policy WHERE id',
    )).rows[0];
    if (parsed.status) {
      const row = await read();
      if (!row) {
        console.log('AGE POLICY: brak wiersza progu (obowiązuje 18).');
      } else {
        console.log(`AGE POLICY: próg = ${row.candidate_min_age}, zatwierdzony = ${row.confirmed ? 'tak' : 'nie'}, `
          + `znacznik = ${row.updated_at}`);
      }
      return 0;
    }
    try {
      await client.query('SELECT public.owner_confirm_candidate_min_age($1, $2, $3)',
        [parsed.minAge, parsed.expected, parsed.note]);
    } catch (error) {
      const code = /STALE_STATE|VALIDATION_FAILED|PERMISSION_DENIED/.exec(String(error?.message))?.[0] ?? 'ERROR';
      console.error(`AGE POLICY: odmowa bazy (${code}).`);
      return 1;
    }
    const row = await read();
    console.log(`AGE POLICY: próg ${row?.candidate_min_age} zatwierdzony (wpis audytu age_policy.owner_confirmed).`);
    return 0;
  } finally {
    await client.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().then((code) => { process.exitCode = code; }, () => {
    console.error('AGE POLICY: błąd połączenia lub zapytania.');
    process.exitCode = 1;
  });
}

#!/usr/bin/env node
// =============================================================================
// scripts/db/set-portal-legal-mode.mjs — zmiana trybu portalu w bazie (#1143, migracja 0171).
//
// Poza CI. Tryb efektywny aplikacji = env PORTAL_LEGAL_MODE=RECRUITMENT (#1136) ORAZ tryb
// w bazie; ten skrypt zmienia wyłącznie część bazodanową, jedyną drogą zapisu — RPC
// `admin_set_portal_legal_mode` (uzasadnienie, CAS po oczekiwanym trybie, audyt
// `portal_legal_mode.changed`). Procedura: docs/railway/OPERATIONS.md („Tryb portalu”).
//
// Użycie (login migratora, nigdy DATABASE_URL aplikacji):
//   MIGRATION_DATABASE_URL=… node scripts/db/set-portal-legal-mode.mjs --status
//   MIGRATION_DATABASE_URL=… node scripts/db/set-portal-legal-mode.mjs \
//     --mode RECRUITMENT --expected CLASSIFIEDS_ONLY --reason "…" --confirm RECRUITMENT
// `--confirm` musi powtórzyć docelowy tryb (jawne potwierdzenie). Skrypt nie wypisuje URL-i.
// Kod wyjścia: 0 = OK, 1 = odmowa bazy (np. STALE_STATE), 2 = konfiguracja/argumenty.
// =============================================================================
import { pathToFileURL } from 'node:url';
import pg from 'pg';

export const PORTAL_MODES = ['CLASSIFIEDS_ONLY', 'RECRUITMENT'];
export const REASON_MAX = 1000;

/**
 * @param {string[]} argv
 * @returns {{ok: true, status: true} | {ok: true, status: false, mode: string, expected: string, reason: string}
 *   | {ok: false, error: string}}
 */
export function parsePortalModeArgs(argv) {
  const values = {};
  let status = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--status') { status = true; continue; }
    const match = /^--(mode|expected|reason|confirm)(?:=(.*))?$/.exec(arg);
    if (!match) return { ok: false, error: `Nieznany argument: ${arg}` };
    const value = match[2] ?? argv[++i];
    if (value === undefined) return { ok: false, error: `Brak wartości dla --${match[1]}` };
    values[match[1]] = value;
  }
  if (status) {
    return Object.keys(values).length ? { ok: false, error: '--status nie łączy się z innymi argumentami' } : { ok: true, status: true };
  }
  const { mode, expected, confirm } = values;
  const reason = (values.reason ?? '').trim();
  if (!PORTAL_MODES.includes(mode ?? '')) return { ok: false, error: `--mode: ${PORTAL_MODES.join(' | ')}` };
  if (!PORTAL_MODES.includes(expected ?? '')) return { ok: false, error: `--expected: ${PORTAL_MODES.join(' | ')}` };
  if (!reason || reason.length > REASON_MAX) return { ok: false, error: `--reason: wymagane, 1–${REASON_MAX} znaków` };
  if (confirm !== mode) return { ok: false, error: '--confirm musi powtórzyć docelowy tryb (--mode)' };
  return { ok: true, status: false, mode, expected, reason };
}

async function main() {
  const parsed = parsePortalModeArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(`PORTAL MODE: ${parsed.error}`);
    return 2;
  }
  const connectionString = process.env.MIGRATION_DATABASE_URL;
  if (!connectionString) {
    console.error('PORTAL MODE: ustaw MIGRATION_DATABASE_URL (login migratora).');
    return 2;
  }
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const read = async () => (await client.query(
      "SELECT CASE WHEN public.recruitment_enabled() THEN 'RECRUITMENT' ELSE 'CLASSIFIEDS_ONLY' END AS mode",
    )).rows[0].mode;
    if (parsed.status) {
      console.log(`PORTAL MODE: baza = ${await read()}`);
      return 0;
    }
    try {
      await client.query('SELECT public.admin_set_portal_legal_mode($1, $2, $3)',
        [parsed.mode, parsed.reason, parsed.expected]);
    } catch (error) {
      const code = /STALE_STATE|VALIDATION_FAILED|PERMISSION_DENIED/.exec(String(error?.message))?.[0] ?? 'ERROR';
      console.error(`PORTAL MODE: odmowa bazy (${code}).`);
      return 1;
    }
    console.log(`PORTAL MODE: baza = ${await read()} (wpis audytu portal_legal_mode.changed).`);
    if (parsed.mode === 'RECRUITMENT') {
      console.log('PORTAL MODE: rekrutacja działa dopiero przy PORTAL_LEGAL_MODE=RECRUITMENT w Railway; '
        + 'każda funkcja wymaga osobnej decyzji właściciela.');
    }
    return 0;
  } finally {
    await client.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().then((code) => { process.exitCode = code; }, () => {
    console.error('PORTAL MODE: błąd połączenia lub zapytania.');
    process.exitCode = 1;
  });
}

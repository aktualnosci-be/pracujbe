#!/usr/bin/env node
// =============================================================================
// scripts/db/requeue-failed-emails.mjs — ponowne zakolejkowanie nieudanych e-maili
// (#1214, migracja 0980 — numer tymczasowy).
//
// Poza CI, bez UI. Po naprawie błędu konfiguracji nadawcy/dostawcy (np. EMAIL_FROM wpisany
// z cudzysłowami, niezweryfikowana domena) listy, które przed poprawką przeszły w `failed`,
// wracają do kolejki jedyną drogą — RPC `requeue_failed_email_deliveries` (service_role):
// tylko niewygaszone (bez suppressed_at), spoza kampanii, nieprzyjęte przez dostawcę,
// z ostatnich N dni (1–30). Claim workera ponownie sprawdza zgodę i blokadę adresu.
// Procedura: docs/railway/OPERATIONS.md („Poczta: błąd konfiguracji nadawcy”).
//
// Użycie (login migratora, nigdy DATABASE_URL aplikacji):
//   MIGRATION_DATABASE_URL=… node scripts/db/requeue-failed-emails.mjs --days 3            # podgląd
//   MIGRATION_DATABASE_URL=… node scripts/db/requeue-failed-emails.mjs --days 3 \
//     --template supportContact --error EMAIL_PROVIDER_REJECTED --apply --confirm 3
// Bez `--apply` = dry-run (same liczby). `--confirm` musi powtórzyć liczbę dni (jawne potwierdzenie).
// Skrypt nie wypisuje URL-i ani adresów. Kod wyjścia: 0 = OK, 1 = odmowa bazy, 2 = argumenty/konfiguracja.
// =============================================================================
import { pathToFileURL } from 'node:url';
import pg from 'pg';

export const MAX_DAYS = 30;
const NAME_RE = /^[A-Za-z0-9_.-]{1,80}$/;

/**
 * @param {string[]} argv
 * @returns {{ ok: true, days: number, apply: boolean, templates: string[] | null, errors: string[] | null }
 *   | { ok: false, error: string }}
 */
export function parseRequeueArgs(argv) {
  let days = null;
  let confirm = null;
  let apply = false;
  const templates = [];
  const errors = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') { apply = true; continue; }
    const match = /^--(days|template|error|confirm)(?:=(.*))?$/.exec(arg);
    if (!match) return { ok: false, error: `Nieznany argument: ${arg}` };
    const value = match[2] ?? argv[++i];
    if (value === undefined) return { ok: false, error: `Brak wartości dla --${match[1]}` };
    if (match[1] === 'days') days = value;
    else if (match[1] === 'confirm') confirm = value;
    else {
      if (!NAME_RE.test(value)) return { ok: false, error: `--${match[1]}: niedozwolona wartość` };
      (match[1] === 'template' ? templates : errors).push(value);
    }
  }
  if (days === null || !/^\d{1,2}$/.test(days) || Number(days) < 1 || Number(days) > MAX_DAYS) {
    return { ok: false, error: `--days: liczba 1–${MAX_DAYS}` };
  }
  if (apply && confirm !== days) return { ok: false, error: '--apply wymaga --confirm z tą samą liczbą dni' };
  return {
    ok: true,
    days: Number(days),
    apply,
    templates: templates.length ? templates : null,
    errors: errors.length ? errors : null,
  };
}

async function main() {
  const parsed = parseRequeueArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(`REQUEUE: ${parsed.error}`);
    return 2;
  }
  const connectionString = process.env.MIGRATION_DATABASE_URL;
  if (!connectionString) {
    console.error('REQUEUE: ustaw MIGRATION_DATABASE_URL (login migratora).');
    return 2;
  }
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    let result;
    try {
      result = (await client.query(
        'SELECT public.requeue_failed_email_deliveries($1, $2, $3, $4) AS r',
        [parsed.days, !parsed.apply, parsed.templates, parsed.errors],
      )).rows[0]?.r;
    } catch (error) {
      const code = /VALIDATION_FAILED|permission denied/.exec(String(error?.message))?.[0] ?? 'ERROR';
      console.error(`REQUEUE: odmowa bazy (${code}).`);
      return 1;
    }
    const matched = Number(result?.matched ?? 0);
    const requeued = Number(result?.requeued ?? 0);
    console.log(parsed.apply
      ? `REQUEUE: ponownie w kolejce ${requeued} z ${matched} (wpis audytu email_delivery.requeued).`
      : `REQUEUE: dry-run — pasuje ${matched}; uruchom z --apply --confirm ${parsed.days}, aby zakolejkować.`);
    return 0;
  } finally {
    await client.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().then((code) => { process.exitCode = code; }, () => {
    console.error('REQUEUE: błąd połączenia lub zapytania.');
    process.exitCode = 1;
  });
}

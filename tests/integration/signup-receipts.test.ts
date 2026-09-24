import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadProductionMigrations } from '../../scripts/db/production-migrations.mjs';
import { applyMigrations } from '../../scripts/db/migrate.mjs';

const container = `pracujbe-receipts-test-${randomUUID()}`;
const password = randomUUID();
let created = false;
let admin: Pool | undefined;
let auth: Pool | undefined;
function docker(...args: string[]): string {
  const windows = process.platform === 'win32';
  return execFileSync(windows ? 'wsl.exe' : 'docker', windows ? ['-d', 'Ubuntu', '--', 'docker', ...args] : args,
    { encoding: 'utf8', timeout: 60_000 }).trim();
}

beforeAll(async () => {
  // Wyłącznie własny klaster: żadnego DATABASE_URL z otoczenia aplikacji.
  docker('run', '--detach', '--rm', '--name', container, '--publish', '127.0.0.1::5432',
    '--tmpfs', '/var/lib/postgresql/data', '--env', `POSTGRES_PASSWORD=${password}`,
    '--env', 'POSTGRES_DB=receipts_test', 'postgres:16');
  created = true;
  const port = Number(docker('port', container, '5432/tcp').split(':').at(-1));
  if (!Number.isInteger(port) || port < 1) throw new Error('Brak portu izolowanej bazy.');
  const connection = { host: '127.0.0.1', port, password, database: 'receipts_test', connectionTimeoutMillis: 2_000 };
  admin = new Pool({ ...connection, user: 'postgres', max: 1 });
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { await admin.query('SELECT 1'); ready = true; break; }
    catch { await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  if (!ready) throw new Error('Izolowana baza nie uruchomiła się.');
  const migrations = await loadProductionMigrations();
  // Produkcyjna ścieżka używa jednego połączenia; pool max=1 tylko dla kolejnych asercji.
  const migrator = await admin.connect();
  try {
    expect((await applyMigrations(migrator, migrations)).applied).toBe(migrations.length);
    expect((await applyMigrations(migrator, migrations)).applied).toBe(0);
  } finally { migrator.release(); }
  await admin.query(`CREATE ROLE receipts_auth LOGIN PASSWORD '${password}' NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
    GRANT pracujbe_auth TO receipts_auth;`);
  auth = new Pool({ ...connection, user: 'receipts_auth', options: '-c role=pracujbe_auth -c search_path=auth' });
});

afterAll(async () => {
  try { await auth?.end(); }
  finally {
    try { await admin?.end(); }
    finally { if (created) docker('rm', '--force', container); }
  }
});

async function insert(metadata: Record<string, unknown>, id = randomUUID()) {
  await auth!.query('INSERT INTO auth.users(id,name,email,raw_user_meta_data) VALUES ($1,$2,$3,$4)',
    [id, 'Osoba Testowa', `${id}@example.invalid`, metadata]);
  return id;
}

describe('Atomowe receipty rejestracji', () => {
  it.each(['pl', 'nl', 'fr', 'en'])('v1 (formularz sprzed #493) zapisuje dawny wspólny receipt dla %s', async locale => {
    const id = await insert({ role: 'employer', locale, agree_terms: true, signup_receipt_version: 1 });
    const profile = await admin!.query('SELECT role, preferred_locale, signup_locale FROM public.profiles WHERE id=$1', [id]);
    expect(profile.rows[0]).toEqual({ role: 'employer', preferred_locale: locale, signup_locale: locale });
    const receipts = await admin!.query('SELECT document,locale,accepted_at FROM public.document_acceptances WHERE profile_id=$1 ORDER BY document', [id]);
    expect(receipts.rows.map(row => ({ document: row.document, locale: row.locale })))
      .toEqual([{ document: 'privacy', locale }, { document: 'terms', locale }]);
    expect(receipts.rows.every(row => row.accepted_at instanceof Date)).toBe(true);
    const kinds = await admin!.query('SELECT DISTINCT kind FROM public.document_acceptances WHERE profile_id=$1', [id]);
    expect(kinds.rows).toEqual([{ kind: 'legacy_combined' }]);
  });

  it.each(['pl', 'nl', 'fr', 'en'])('v2 (#493): osobne receipty i zgoda opcjonalna dla %s', async locale => {
    const id = await insert({
      role: 'candidate', locale, agree_terms: true, privacy_notice_ack: true, signup_receipt_version: 2,
      optional_consents: { email_marketing: locale === 'fr' },
      consent_wording: { terms: 'sha256:aa', privacy: 'sha256:bb', email_marketing: 'sha256:cc' },
    });
    const receipts = await admin!.query(
      'SELECT document, kind, source, locale, document_version FROM public.document_acceptances WHERE profile_id=$1 ORDER BY document', [id]);
    expect(receipts.rows).toEqual([
      { document: 'privacy', kind: 'privacy_notice_ack', source: 'signup', locale, document_version: 'sha256:bb' },
      { document: 'terms', kind: 'terms_acceptance', source: 'signup', locale, document_version: 'sha256:aa' },
    ]);
    const optional = await admin!.query('SELECT purpose, granted, wording_version FROM public.optional_consents WHERE profile_id=$1', [id]);
    expect(optional.rows).toEqual([{ purpose: 'email_marketing', granted: locale === 'fr', wording_version: 'sha256:cc' }]);
  });

  // Nieznany język odrzuca klucz obcy profiles → supported_locales (0069, 23503) zanim
  // walidacja receiptów zdąży rzucić 23514; w obu przypadkach bez częściowego konta.
  it.each([
    [{ agree_terms: false }, '23514'], [{ agree_terms: 'true' }, '23514'], [{ role: 'admin' }, '23514'],
    [{ locale: 'de' }, '23503'], [{ signup_receipt_version: 3 }, '23514'],
    [{ signup_receipt_version: 2 }, '23514'],
    [{ signup_receipt_version: 2, privacy_notice_ack: true, optional_consents: { ai: true } }, '23514'],
  ] as const)('odrzuca błędny marker bez częściowego konta: %j', async (invalid, code) => {
      const id = randomUUID();
      await expect(insert({ role: 'candidate', locale: 'pl', agree_terms: true, signup_receipt_version: 1, ...invalid }, id))
        .rejects.toMatchObject({ code });
      for (const table of ['auth.users', 'public.profiles']) {
        expect((await admin!.query(`SELECT id FROM ${table} WHERE id=$1`, [id])).rows).toHaveLength(0);
      }
      expect((await admin!.query('SELECT id FROM public.document_acceptances WHERE profile_id=$1', [id])).rows).toHaveLength(0);
    });

  it('nie przypisuje fikcyjnej akceptacji kontu technicznemu bez markera', async () => {
    const id = await insert({ role: 'candidate', locale: 'pl' });
    expect((await admin!.query('SELECT id FROM public.document_acceptances WHERE profile_id=$1', [id])).rows).toHaveLength(0);
  });

  it('awaria receiptu cofa także utworzenie użytkownika i profilu', async () => {
    await admin!.query(`CREATE FUNCTION public.fail_receipt_test() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'kontrolowana awaria receiptu'; END $$;
      CREATE TRIGGER fail_receipt_test BEFORE INSERT ON public.document_acceptances FOR EACH ROW EXECUTE FUNCTION public.fail_receipt_test();`);
    const id = randomUUID();
    try {
      await expect(insert({ role: 'candidate', locale: 'pl', agree_terms: true, signup_receipt_version: 1 }, id)).rejects.toThrow('kontrolowana awaria receiptu');
      expect((await admin!.query('SELECT id FROM auth.users WHERE id=$1', [id])).rows).toHaveLength(0);
      expect((await admin!.query('SELECT id FROM public.profiles WHERE id=$1', [id])).rows).toHaveLength(0);
    } finally {
      await admin!.query('DROP TRIGGER fail_receipt_test ON public.document_acceptances; DROP FUNCTION public.fail_receipt_test()');
    }
  });
});

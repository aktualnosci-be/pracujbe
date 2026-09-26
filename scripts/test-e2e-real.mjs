#!/usr/bin/env node
// =============================================================================
// scripts/test-e2e-real.mjs — E2E przepływu kandydat ↔ pracodawca na PRAWDZIWYM PostgreSQL 16
// (#351, #66). Jedno polecenie: `npm run test:e2e:real`.
//
// 1. Tworzy świeżą bazę o JAWNEJ nazwie na JAWNYM hoście/porcie (bez DATABASE_URL, bez Dockera).
// 2. Nakłada PRODUKCYJNY zestaw migracji (bootstrap ról + domena + auth) tym samym runnerem,
//    co wdrożenie (scripts/db/migrate.mjs).
// 3. Tworzy dwa jednorazowe, ograniczone loginy runtime (NOINHERIT, członkostwo tylko
//    pracujbe_app / pracujbe_auth) — aplikacja i test NIGDY nie łączą się jako migrator.
// 4. Uruchamia Playwright z `playwright.real-flow.config.ts`; argumenty są przekazywane dalej.
// 5. Zawsze sprząta bazę i loginy (E2E_REAL_KEEP=1 zostawia bazę do diagnozy).
//
// Zmienne (wartości domyślne dla lokalnego klastra PG16):
//   E2E_PGHOST=127.0.0.1  E2E_PGPORT=5432  E2E_PGUSER=postgres  E2E_PGPASSWORD=postgres
//   E2E_PGDATABASE=pracujbe_e2e_real   (nazwa MUSI zawierać „e2e” — ochrona przed pomyłką)
//
// Kontrola ujemna: E2E_REAL_MUTATION=<nazwa> celowo psuje jedną regułę (lista MUTATIONS niżej;
// `retry-new-key` psuje klienta: ponowienie z nowym kluczem idempotencji). Każdy wariant MUSI
// zakończyć się czerwonym testem — inaczej scenariusz nie dowodzi tego, co deklaruje.
// =============================================================================
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { applyMigrations } from './db/migrate.mjs';
import { loadProductionMigrations } from './db/production-migrations.mjs';

const host = process.env.E2E_PGHOST || '127.0.0.1';
const port = Number(process.env.E2E_PGPORT || 5432);
const user = process.env.E2E_PGUSER || 'postgres';
const password = process.env.E2E_PGPASSWORD ?? 'postgres';
const database = process.env.E2E_PGDATABASE || 'pracujbe_e2e_real';
const keep = process.env.E2E_REAL_KEEP === '1';
const mutation = process.env.E2E_REAL_MUTATION || '';

/** Sabotaż reguł w bazie testowej (tylko ta baza; stosowany po migracjach). */
const MUTATIONS = {
  // RLS aplikacji wyłączone → inny kandydat/obca firma widzą cudze zgłoszenie.
  'rls-applications-off': 'ALTER TABLE public.applications DISABLE ROW LEVEL SECURITY',
  // Finalizacja zwraca sukces bez oznaczenia profilu (pozorny sukces, P1-07).
  'finish-onboarding-noop': `CREATE OR REPLACE FUNCTION public.finish_onboarding() RETURNS boolean
    LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$ SELECT true $$`,
  // Krok 5 połyka błąd certyfikatów i zostawia zapisane języki (brak atomowości, #142).
  'step5-swallow-error': `CREATE OR REPLACE FUNCTION public.save_candidate_onboarding_step5(p_languages jsonb, p_certificates jsonb)
    RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
    BEGIN
      PERFORM public.ensure_candidate_profile();
      PERFORM public.set_candidate_languages(p_languages);
      BEGIN PERFORM public.set_candidate_certificates(p_certificates); EXCEPTION WHEN others THEN NULL; END;
    END $$`,
  // Onboarding (#66): wyszukiwalność bez sprawdzenia kompletności profilu.
  'searchable-without-complete': `CREATE OR REPLACE FUNCTION public.set_candidate_searchable(p_searchable boolean)
    RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    UPDATE public.candidate_profiles SET is_searchable = coalesce(p_searchable, false) WHERE profile_id = auth.uid()
    RETURNING is_searchable $$`,
  // Onboarding (#66): umiejętności dopisywane zamiast replace-all (edycja nie usuwa pozycji).
  'skills-append': `CREATE OR REPLACE FUNCTION public.set_candidate_skills(p_skills text[])
    RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
    DECLARE v_cp uuid := public.ensure_candidate_profile();
    BEGIN
      INSERT INTO public.candidate_skills (candidate_profile_id, skill_label)
        SELECT DISTINCT v_cp, left(btrim(s), 120) FROM unnest(coalesce(p_skills, '{}')) s WHERE btrim(s) <> ''
      ON CONFLICT (candidate_profile_id, skill_label) DO NOTHING;
    END $$`,
  // Onboarding (#66): klient sam ustawia profile_completed/is_searchable (brak guardu 0029).
  'completeness-guard-off': 'DROP TRIGGER trg_guard_candidate_completeness ON public.candidate_profiles',
  // Onboarding (#66): relacje profilu zapisywalne bezpośrednim DML (obejście RPC, 0028).
  'relations-dml-open': `GRANT INSERT, DELETE ON public.candidate_skills, public.candidate_languages,
    public.candidate_certificates TO authenticated`,
  // Język e-maila nie z profilu odbiorcy (Invariant #1).
  'recipient-locale-en': `CREATE OR REPLACE FUNCTION public.resolve_recipient_locale(p_profile_id uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT 'en'::text $$`,
  // #497 (0201): pytanie odrzucone po publikacji wraca do formularza aplikowania.
  'screening-hidden-off': `CREATE OR REPLACE FUNCTION public.get_public_job_screening_questions(p_job_id uuid)
    RETURNS TABLE (id uuid, "position" smallint, type text, required boolean, prompt jsonb, options jsonb)
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT q.id, q.position, q.type, q.required, q.prompt, q.options FROM public.job_screening_questions q
     WHERE q.job_id = p_job_id AND public.job_is_public(p_job_id) ORDER BY q.position $$`,
  // Lejek ofert bez deduplikacji po nonce: ponowienie tego samego zgłoszenia liczy się dwa razy (#99).
  'funnel-no-dedup': 'ALTER TABLE public.job_funnel_receipts DROP CONSTRAINT job_funnel_receipts_pkey',
  // UI (#351): odpowiedź na propozycję zwraca sukces bez zmiany stanu — panel pokazuje
  // „zaakceptowano”, baza nie (pozorny sukces).
  'respond-offer-noop': `CREATE OR REPLACE FUNCTION public.respond_to_offer(p_offer_id uuid, p_accept boolean)
    RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$ BEGIN END $$`,
  // UI (#351): zmiana statusu zgłoszenia z panelu pracodawcy bez zapisu i historii.
  'transition-noop': `CREATE OR REPLACE FUNCTION public.transition_application(p_application_id uuid, p_target text)
    RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$ BEGIN END $$`,
  // Kreator oferty (Etap 8): zapis kroku zwraca sukces bez zmian w bazie (pozorny zapis szkicu).
  'wizard-draft-noop': `CREATE OR REPLACE FUNCTION public.save_job_draft(p_job_id uuid, p_content jsonb)
    RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$ BEGIN END $$`,
  // Kreator oferty (Etap 8): publikacja bez sprawdzenia weryfikacji firmy (reszta publish_job bez zmian).
  'publish-unverified': `DO $mut$ DECLARE d text; BEGIN
      d := pg_get_functiondef('public.publish_job(uuid, text)'::regprocedure);
      IF position($q$v_cstatus <> 'verified'$q$ IN d) = 0 THEN RAISE EXCEPTION 'mutacja: brak warunku weryfikacji'; END IF;
      EXECUTE replace(d, $q$v_cstatus <> 'verified'$q$, 'false');
    END $mut$`,
  'retry-new-key': null,
};
if (mutation && !Object.hasOwn(MUTATIONS, mutation)) {
  console.error(`Nieznana mutacja „${mutation}”. Dostępne: ${Object.keys(MUTATIONS).join(', ')}.`);
  process.exit(2);
}

if (!/^[a-z][a-z0-9_]*e2e[a-z0-9_]*$/.test(database)) {
  console.error('E2E_PGDATABASE musi być nazwą bazy testowej zawierającą „e2e” (a-z, 0-9, _).');
  process.exit(2);
}
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('Nieprawidłowy E2E_PGPORT.');
  process.exit(2);
}

const url = (login, secret, db) =>
  `postgresql://${encodeURIComponent(login)}:${encodeURIComponent(secret)}@${host}:${port}/${db}`;

const suffix = randomBytes(4).toString('hex');
const logins = {
  app: { name: `e2e_real_app_${suffix}`, role: 'pracujbe_app', password: randomBytes(24).toString('hex') },
  auth: { name: `e2e_real_auth_${suffix}`, role: 'pracujbe_auth', password: randomBytes(24).toString('hex') },
};

async function withClient(db, fn) {
  const client = new pg.Client({ connectionString: url(user, password, db), connectionTimeoutMillis: 5_000 });
  await client.connect();
  try { return await fn(client); } finally { await client.end(); }
}

async function prepare() {
  console.log(`>> PostgreSQL ${host}:${port}, baza „${database}” (użytkownik migracji: ${user})`);
  await withClient('postgres', async (c) => {
    const major = (await c.query('SHOW server_version_num')).rows[0].server_version_num;
    if (Math.floor(Number(major) / 10000) !== 16) throw new Error(`Wymagany PostgreSQL 16 (jest ${major}).`);
    await c.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
    await c.query(`CREATE DATABASE ${database}`);
  });
  await withClient(database, async (c) => {
    const migrations = await loadProductionMigrations();
    const { applied } = await applyMigrations(c, migrations);
    console.log(`>> migracje produkcyjne: ${applied}`);
    for (const login of Object.values(logins)) {
      // Nazwy i hasła generujemy sami (hex), więc interpolacja nie przyjmuje danych z zewnątrz.
      await c.query(`CREATE ROLE ${login.name} LOGIN PASSWORD '${login.password}'
        NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
      await c.query(`GRANT ${login.role} TO ${login.name}`);
      await c.query(`GRANT CONNECT ON DATABASE ${database} TO ${login.name}`);
    }
    if (MUTATIONS[mutation]) {
      await c.query(MUTATIONS[mutation]);
      console.log(`>> KONTROLA UJEMNA: mutacja „${mutation}” — oczekiwany czerwony test.`);
    }
    // Rejestracja wymaga bieżących wersji dokumentów (receipty regulaminu i polityki, 0059).
    for (const locale of ['pl', 'nl', 'fr', 'en']) {
      for (const document of ['terms', 'privacy']) {
        await c.query(
          `INSERT INTO public.consent_versions(document, version, locale, is_current, published_at)
           VALUES ($1, $2, $3, true, now())`,
          [document, `${document}-${locale}-e2e`, locale],
        );
      }
    }
  });
}

async function cleanup() {
  if (keep) {
    console.log(`>> E2E_REAL_KEEP=1 — baza „${database}” i loginy zostają.`);
    return;
  }
  await withClient('postgres', async (c) => {
    await c.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
    for (const login of Object.values(logins)) await c.query(`DROP ROLE IF EXISTS ${login.name}`);
  }).catch((error) => console.error('Sprzątanie nie powiodło się:', error.message));
}

const serverOnlyHook = fileURLToPath(new URL('../tests/e2e-real/support/server-only-hook.cjs', import.meta.url));

function runPlaywright() {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ['node_modules/@playwright/test/cli.js', 'test', '-c', 'playwright.real-flow.config.ts', ...process.argv.slice(2)],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          E2E_REAL_ADMIN_URL: url(user, password, database),
          E2E_REAL_APP_URL: url(logins.app.name, logins.app.password, database),
          E2E_REAL_AUTH_URL: url(logins.auth.name, logins.auth.password, database),
          E2E_REAL_DATABASE: database,
          E2E_REAL_MUTATION: mutation,
          // Proces testów importuje moduły serwerowe aplikacji — patrz server-only-hook.cjs.
          NODE_OPTIONS: [process.env.NODE_OPTIONS, `--require=${serverOnlyHook}`].filter(Boolean).join(' '),
        },
      },
    );
    child.on('exit', (code, signal) => resolve(signal ? 1 : code ?? 1));
  });
}

let code = 1;
try {
  await prepare();
  code = await runPlaywright();
} catch (error) {
  console.error('Przygotowanie E2E na PostgreSQL nie powiodło się:', error.message);
} finally {
  await cleanup();
}
process.exit(code);

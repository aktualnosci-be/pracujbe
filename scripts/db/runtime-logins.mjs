import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { loadProductionMigrations } from "./production-migrations.mjs";

export const LOGIN_SPECS = [
  {
    key: "web",
    login: "pracujbe_web",
    role: "pracujbe_app",
    passwordEnv: "DATABASE_APP_PASSWORD",
    nextPasswordEnv: "DATABASE_APP_NEW_PASSWORD",
  },
  {
    key: "auth",
    login: "pracujbe_auth_runtime",
    role: "pracujbe_auth",
    passwordEnv: "AUTH_DATABASE_PASSWORD",
    nextPasswordEnv: "AUTH_DATABASE_NEW_PASSWORD",
  },
  {
    key: "limiter",
    login: "pracujbe_limiter",
    role: "pracujbe_rate_limit",
    passwordEnv: "RATE_LIMIT_DATABASE_PASSWORD",
    nextPasswordEnv: "RATE_LIMIT_DATABASE_NEW_PASSWORD",
  },
  {
    key: "auth-mail",
    login: "pracujbe_auth_mail_runtime",
    role: "pracujbe_auth_mail",
    passwordEnv: "AUTH_MAIL_DATABASE_PASSWORD",
    nextPasswordEnv: "AUTH_MAIL_DATABASE_NEW_PASSWORD",
  },
];

function required(env, name) {
  const value = env[name];
  if (!value) throw new Error(`Brak wymaganej zmiennej ${name}.`);
  return value;
}

function validatePassword(value) {
  if (value.length < 32 || value.includes("\0")) {
    throw new Error(
      "Hasło loginu bazy musi mieć co najmniej 32 znaki i nie może zawierać NUL.",
    );
  }
  return value;
}

async function installPasswordHelpers(client) {
  // Sekret idzie jako parametr protokołu, nigdy jako fragment tekstu SQL/argv/logu skryptu.
  await client.query(`CREATE OR REPLACE FUNCTION pg_temp.create_runtime_login(
      target name, membership name, secret text) RETURNS void LANGUAGE plpgsql AS $$
    BEGIN
      EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION', target, secret);
      EXECUTE format('GRANT %I TO %I', membership, target);
    END $$`);
  await client.query(`CREATE OR REPLACE FUNCTION pg_temp.rotate_runtime_password(
      target name, secret text) RETURNS void LANGUAGE plpgsql AS $$
    BEGIN
      EXECUTE format('ALTER ROLE %I PASSWORD %L', target, secret);
    END $$`);
}

function assertExpectedMigrations(migrations) {
  if (
    migrations[0]?.name !== "0000_bootstrap_roles_and_identity.sql" ||
    migrations.at(-1)?.name !== "0061_auth_email_outbox.sql"
  ) {
    throw new Error(
      "Repozytorium nie zawiera oczekiwanego zakresu migracji 0000..0061.",
    );
  }
  for (let number = 0; number <= 61; number++) {
    const prefix = String(number).padStart(4, "0");
    if (
      !migrations.some((migration) => migration.name.startsWith(`${prefix}_`))
    ) {
      throw new Error(`Brak migracji ${prefix}.`);
    }
  }
}

async function verifyTarget(client, env, migrations) {
  const expectedDatabase = required(env, "EXPECTED_DATABASE_NAME");
  const expectedUser = required(env, "EXPECTED_MIGRATION_USER");
  const expectedMajor = Number(required(env, "EXPECTED_POSTGRES_MAJOR"));
  if (!Number.isInteger(expectedMajor) || expectedMajor < 16) {
    throw new Error("EXPECTED_POSTGRES_MAJOR musi być liczbą co najmniej 16.");
  }
  const target = (
    await client.query(`SELECT current_database() AS database, current_user AS username,
    session_user AS session_username,
    current_setting('server_version_num')::integer / 10000 AS major,
    pg_is_in_recovery() AS recovery`)
  ).rows[0];
  if (
    target?.database !== expectedDatabase ||
    target?.username !== expectedUser ||
    target?.session_username !== expectedUser ||
    target?.major !== expectedMajor ||
    target?.recovery !== false
  ) {
    throw new Error(
      "Połączenie nie wskazuje oczekiwanej zapisywalnej bazy, użytkownika lub wersji PostgreSQL.",
    );
  }

  const history = (
    await client.query(
      `SELECT name, checksum FROM app_migrations.history ORDER BY name`,
    )
  ).rows;
  if (
    history.length !== migrations.length ||
    history.some(
      (row, index) =>
        row.name !== migrations[index]?.name ||
        row.checksum !== migrations[index]?.checksum,
    )
  ) {
    throw new Error(
      "Historia migracji nie odpowiada dokładnie plikom 0000..0061.",
    );
  }

  const roleFlags = (
    await client.query(
      `SELECT rolname, rolcanlogin, rolsuper, rolcreatedb,
      rolcreaterole, rolreplication, rolinherit, rolbypassrls
    FROM pg_roles WHERE rolname = ANY($1::text[])`,
      [
        [
          "anon",
          "authenticated",
          "service_role",
          "pracujbe_app",
          "pracujbe_auth",
          "pracujbe_rate_limit",
          "pracujbe_auth_mail",
        ],
      ],
    )
  ).rows;
  if (
    roleFlags.length !== 7 ||
    roleFlags.some(
      (role) =>
        role.rolcanlogin ||
        role.rolsuper ||
        role.rolcreatedb ||
        role.rolcreaterole ||
        role.rolreplication ||
        role.rolinherit ||
        role.rolbypassrls !== (role.rolname === "service_role"),
    )
  ) {
    throw new Error("Role bazowe mają niezgodne flagi bezpieczeństwa.");
  }
  const baseMemberships = (
    await client.query(
      `SELECT member_role.rolname AS member, parent_role.rolname AS parent,
      m.admin_option
    FROM pg_auth_members m
    JOIN pg_roles member_role ON member_role.oid=m.member
    JOIN pg_roles parent_role ON parent_role.oid=m.roleid
    WHERE member_role.rolname = ANY($1::text[])
    ORDER BY member_role.rolname, parent_role.rolname`,
      [roleFlags.map((role) => role.rolname)],
    )
  ).rows;
  if (
    baseMemberships.length !== 2 ||
    baseMemberships.some(
      (membership) =>
        membership.member !== "pracujbe_app" ||
        !["anon", "authenticated"].includes(membership.parent) ||
        membership.admin_option,
    ) ||
    !baseMemberships.some((membership) => membership.parent === "anon") ||
    !baseMemberships.some((membership) => membership.parent === "authenticated")
  ) {
    throw new Error("Role bazowe mają niezgodne członkostwa.");
  }

  const withoutRls = (
    await client.query(`SELECT n.nspname, c.relname
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','auth') AND c.relkind IN ('r','p') AND NOT c.relrowsecurity
    ORDER BY n.nspname, c.relname`)
  ).rows;
  if (withoutRls.length)
    throw new Error(
      "Co najmniej jedna tabela aplikacyjna nie ma włączonego RLS.",
    );

  const counts = (
    await client.query(`SELECT
    (SELECT count(*)::integer FROM auth.users) AS users,
    (SELECT count(*)::integer FROM public.profiles) AS profiles,
    (SELECT count(*)::integer FROM public.companies) AS companies,
    (SELECT count(*)::integer FROM public.jobs) AS jobs,
    (SELECT count(*)::integer FROM public.applications) AS applications,
    (SELECT count(*)::integer FROM public.offers) AS offers`)
  ).rows[0];
  if (!counts || Object.values(counts).some((count) => count !== 0)) {
    throw new Error("Baza nie jest pustym startem portalu.");
  }
}

async function readLoginState(client) {
  const logins = LOGIN_SPECS.map((spec) => spec.login);
  const rows = (
    await client.query(
      `SELECT r.rolname, r.rolcanlogin, r.rolsuper, r.rolcreatedb,
      r.rolcreaterole, r.rolreplication, r.rolinherit, r.rolbypassrls,
      coalesce(json_agg(parent.rolname ORDER BY parent.rolname)
        FILTER (WHERE parent.rolname IS NOT NULL), '[]'::json) AS memberships,
      coalesce(bool_or(m.admin_option), false) AS has_admin_option,
      EXISTS (SELECT 1 FROM pg_database d WHERE d.datdba=r.oid) AS owns_database,
      (EXISTS (SELECT 1 FROM pg_database d WHERE d.datdba=r.oid OR EXISTS (
          SELECT 1 FROM aclexplode(d.datacl) a WHERE a.grantee=r.oid))
       OR EXISTS (SELECT 1 FROM pg_namespace n WHERE n.nspowner=r.oid OR EXISTS (
          SELECT 1 FROM aclexplode(n.nspacl) a WHERE a.grantee=r.oid))
       OR EXISTS (SELECT 1 FROM pg_class c WHERE c.relowner=r.oid OR EXISTS (
          SELECT 1 FROM aclexplode(c.relacl) a WHERE a.grantee=r.oid))
       OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.proowner=r.oid OR EXISTS (
          SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee=r.oid))
       OR EXISTS (SELECT 1 FROM pg_type t WHERE t.typowner=r.oid OR EXISTS (
          SELECT 1 FROM aclexplode(t.typacl) a WHERE a.grantee=r.oid))
       OR EXISTS (SELECT 1 FROM pg_default_acl d WHERE d.defaclrole=r.oid OR EXISTS (
          SELECT 1 FROM aclexplode(d.defaclacl) a WHERE a.grantee=r.oid))) AS has_direct_object_authority
    FROM pg_roles r
    LEFT JOIN pg_auth_members m ON m.member=r.oid
    LEFT JOIN pg_roles parent ON parent.oid=m.roleid
    WHERE r.rolname = ANY($1::text[])
    GROUP BY r.oid, r.rolname, r.rolcanlogin, r.rolsuper, r.rolcreatedb,
      r.rolcreaterole, r.rolreplication, r.rolinherit, r.rolbypassrls`,
      [logins],
    )
  ).rows;
  return new Map(rows.map((row) => [row.rolname, row]));
}

function assertSafeLogin(row, spec) {
  if (!row) return;
  if (
    !row.rolcanlogin ||
    row.rolsuper ||
    row.rolcreatedb ||
    row.rolcreaterole ||
    row.rolreplication ||
    row.rolinherit ||
    row.rolbypassrls ||
    row.has_admin_option ||
    row.owns_database ||
    row.has_direct_object_authority ||
    row.memberships.length !== 1 ||
    row.memberships[0] !== spec.role
  ) {
    throw new Error(`Login ${spec.key} ma niezgodne uprawnienia.`);
  }
}

export async function inspectRuntimeLogins(
  client,
  env,
  { requireAll = false } = {},
) {
  const migrations = await loadProductionMigrations();
  assertExpectedMigrations(migrations);
  await verifyTarget(client, env, migrations);
  const state = await readLoginState(client);
  for (const spec of LOGIN_SPECS) {
    const row = state.get(spec.login);
    if (requireAll && !row) throw new Error(`Brak loginu ${spec.key}.`);
    assertSafeLogin(row, spec);
  }
  return state;
}

export async function provisionRuntimeLogins(
  client,
  env,
  { dryRun = false } = {},
) {
  if (dryRun) {
    const state = await inspectRuntimeLogins(client, env);
    const pending = LOGIN_SPECS.filter((spec) => !state.has(spec.login));
    for (const spec of pending)
      validatePassword(required(env, spec.passwordEnv));
    return { changed: 0, pending: pending.map((spec) => spec.key) };
  }
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query("SELECT pg_advisory_xact_lock(724031, 23)");
    await installPasswordHelpers(client);
    // Cel, role i lista braków powstają dopiero pod blokadą transakcyjną.
    const lockedState = await inspectRuntimeLogins(client, env);
    const lockedPending = LOGIN_SPECS.filter(
      (spec) => !lockedState.has(spec.login),
    );
    for (const spec of lockedPending) {
      await client.query("SELECT pg_temp.create_runtime_login($1, $2, $3)", [
        spec.login,
        spec.role,
        validatePassword(required(env, spec.passwordEnv)),
      ]);
    }
    await client.query("COMMIT");
    return { changed: lockedPending.length, pending: [] };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function rotateRuntimeLoginPasswords(
  client,
  env,
  { dryRun = false } = {},
) {
  const passwords = LOGIN_SPECS.map((spec) => [
    spec,
    validatePassword(required(env, spec.nextPasswordEnv)),
  ]);
  if (dryRun) {
    await inspectRuntimeLogins(client, env, { requireAll: true });
    return { changed: 0, pending: LOGIN_SPECS.map((spec) => spec.key) };
  }
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query("SELECT pg_advisory_xact_lock(724031, 23)");
    await installPasswordHelpers(client);
    const lockedState = await inspectRuntimeLogins(client, env, {
      requireAll: true,
    });
    for (const spec of LOGIN_SPECS) {
      const row = lockedState.get(spec.login);
      if (!row) throw new Error(`Brak loginu ${spec.key}.`);
      assertSafeLogin(row, spec);
    }
    for (const [spec, password] of passwords) {
      await client.query("SELECT pg_temp.rotate_runtime_password($1, $2)", [
        spec.login,
        password,
      ]);
    }
    await client.query("COMMIT");
    return { changed: LOGIN_SPECS.length, pending: [] };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export function resolveDryRun(mode, env) {
  const value = env.DB_LOGIN_DRY_RUN;
  if (value && !["yes", "no"].includes(value)) {
    throw new Error("Nieprawidłowy tryb dry-run.");
  }
  // Brak zmiennej nigdy nie oznacza zgody na zapis.
  return ["provision", "rotate"].includes(mode) ? value !== "no" : false;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const mode = argv[0];
  if (
    !["preflight", "provision", "rotate", "verify"].includes(mode) ||
    argv.length !== 1
  ) {
    console.error(
      "Użycie: runtime-logins.mjs preflight|provision|rotate|verify",
    );
    return 2;
  }
  let dryRun;
  try {
    dryRun = resolveDryRun(mode, env);
  } catch {
    console.error("DB_LOGIN_DRY_RUN przyjmuje wyłącznie yes albo no.");
    return 2;
  }
  let client;
  try {
    client = new pg.Client({
      connectionString: required(env, "MIGRATION_DATABASE_URL"),
      connectionTimeoutMillis: 10_000,
    });
    await client.connect();
    if (mode === "preflight") await inspectRuntimeLogins(client, env);
    if (mode === "verify")
      await inspectRuntimeLogins(client, env, { requireAll: true });
    if (mode === "provision")
      await provisionRuntimeLogins(client, env, { dryRun });
    if (mode === "rotate")
      await rotateRuntimeLoginPasswords(client, env, { dryRun });
    console.log(
      dryRun && ["provision", "rotate"].includes(mode)
        ? "Kontrola zakończona: dry-run, bez zmian w bazie."
        : "Kontrola loginów PostgreSQL zakończona pomyślnie.",
    );
    return 0;
  } catch {
    // Błąd sterownika oraz wartości env mogą zawierać sekrety: komunikat jest stały.
    console.error(
      "Operacja loginów PostgreSQL nie powiodła się. Sprawdź konfigurację i stan bazy.",
    );
    return 1;
  } finally {
    await client?.end();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  process.exitCode = await main();
}

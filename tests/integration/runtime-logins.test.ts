import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "../../scripts/db/migrate.mjs";
import { loadProductionMigrations } from "../../scripts/db/production-migrations.mjs";
import {
  inspectRuntimeLogins,
  LOGIN_SPECS,
  provisionRuntimeLogins,
  resolveDryRun,
  rotateRuntimeLoginPasswords,
} from "../../scripts/db/runtime-logins.mjs";

const container = `pracujbe-login-test-${randomUUID()}`;
const database = "runtime_login_test";
const adminPassword = `${randomUUID()}${randomUUID()}`;
const initialPassword = `${randomUUID()}${randomUUID()}`;
const rotatedPassword = `${randomUUID()}${randomUUID()}`;
let port: number;
let created = false;
let admin: pg.Client | undefined;

function docker(...args: string[]): string {
  const windows = process.platform === "win32";
  return execFileSync(
    windows ? "wsl.exe" : "docker",
    windows ? ["-d", "Ubuntu", "--", "docker", ...args] : args,
    { encoding: "utf8", timeout: 60_000 },
  ).trim();
}

function url(user: string, password: string): string {
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@127.0.0.1:${port}/${database}`;
}

function environment() {
  return {
    MIGRATION_DATABASE_URL: url("postgres", adminPassword),
    EXPECTED_DATABASE_NAME: database,
    EXPECTED_MIGRATION_USER: "postgres",
    EXPECTED_POSTGRES_MAJOR: "16",
    DATABASE_APP_PASSWORD: initialPassword,
    AUTH_DATABASE_PASSWORD: initialPassword,
    RATE_LIMIT_DATABASE_PASSWORD: initialPassword,
    AUTH_MAIL_DATABASE_PASSWORD: initialPassword,
    DATABASE_APP_NEW_PASSWORD: rotatedPassword,
    AUTH_DATABASE_NEW_PASSWORD: rotatedPassword,
    RATE_LIMIT_DATABASE_NEW_PASSWORD: rotatedPassword,
    AUTH_MAIL_DATABASE_NEW_PASSWORD: rotatedPassword,
  };
}

async function loginState(user: string, password: string, role: string) {
  const client = new pg.Client({
    connectionString: url(user, password),
    options: `-c role=${role}`,
  });
  try {
    await client.connect();
    return (
      await client.query("SELECT session_user AS login, current_user AS role")
    ).rows[0];
  } finally {
    await client.end().catch(() => undefined);
  }
}

beforeAll(async () => {
  docker(
    "run",
    "--detach",
    "--rm",
    "--name",
    container,
    "--publish",
    "127.0.0.1::5432",
    "--tmpfs",
    "/var/lib/postgresql/data",
    "--env",
    `POSTGRES_PASSWORD=${adminPassword}`,
    "--env",
    `POSTGRES_DB=${database}`,
    "postgres:16",
  );
  created = true;
  port = Number(docker("port", container, "5432/tcp").split(":").at(-1));
  if (!Number.isInteger(port) || port < 1)
    throw new Error("Brak portu izolowanej bazy.");
  admin = new pg.Client({
    connectionString: url("postgres", adminPassword),
    connectionTimeoutMillis: 2_000,
  });
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      await admin.connect();
      ready = true;
      break;
    } catch {
      await admin.end().catch(() => undefined);
      admin = new pg.Client({
        connectionString: url("postgres", adminPassword),
        connectionTimeoutMillis: 2_000,
      });
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  if (!ready) throw new Error("Izolowany PostgreSQL nie uruchomił się.");
  expect(
    (await applyMigrations(admin, await loadProductionMigrations())).applied,
  ).toBe(62);
}, 90_000);

afterAll(async () => {
  try {
    await admin?.end();
  } finally {
    if (created) docker("rm", "--force", container);
  }
});

describe("operator ograniczonych loginów PostgreSQL", () => {
  it("domyślnie wybiera dry-run i wymaga jawnego no do zapisu", () => {
    expect(resolveDryRun("provision", {})).toBe(true);
    expect(resolveDryRun("rotate", {})).toBe(true);
    expect(resolveDryRun("provision", { DB_LOGIN_DRY_RUN: "yes" })).toBe(true);
    expect(resolveDryRun("provision", { DB_LOGIN_DRY_RUN: "no" })).toBe(false);
    expect(() =>
      resolveDryRun("provision", { DB_LOGIN_DRY_RUN: "false" }),
    ).toThrow();
  });

  it("dry-run jest tylko odczytem, a konflikt trzeciego loginu nie zostawia częściowego provisioningu", async () => {
    const preview = await provisionRuntimeLogins(admin!, environment(), {
      dryRun: true,
    });
    expect(preview).toEqual({
      changed: 0,
      pending: ["web", "auth", "limiter", "auth-mail"],
    });
    expect(
      (
        await admin!.query(
          `SELECT count(*)::integer AS count FROM pg_roles
      WHERE rolname = ANY($1::text[])`,
          [LOGIN_SPECS.map((spec) => spec.login)],
        )
      ).rows[0]?.count,
    ).toBe(0);

    let creates = 0;
    const interrupted = {
      query: async (sql: string, parameters?: unknown[]) => {
        if (
          sql.startsWith("SELECT pg_temp.create_runtime_login") &&
          ++creates === 3
        ) {
          throw new Error("kontrolowana awaria po dwóch zapisach");
        }
        return admin!.query(sql, parameters);
      },
    };
    await expect(
      provisionRuntimeLogins(interrupted, environment()),
    ).rejects.toThrow("kontrolowana awaria");
    expect(
      (
        await admin!.query(
          `SELECT count(*)::integer AS count FROM pg_roles
      WHERE rolname = ANY($1::text[])`,
          [LOGIN_SPECS.map((spec) => spec.login)],
        )
      ).rows[0]?.count,
    ).toBe(0);

    await admin!
      .query(`CREATE ROLE pracujbe_limiter LOGIN PASSWORD '${initialPassword}'
      INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`);
    await admin!.query(
      "GRANT pracujbe_rate_limit, service_role TO pracujbe_limiter",
    );
    await expect(provisionRuntimeLogins(admin!, environment())).rejects.toThrow(
      "niezgodne uprawnienia",
    );
    expect(
      (
        await admin!.query(
          `SELECT count(*)::integer AS count FROM pg_roles
      WHERE rolname = ANY($1::text[])`,
          [LOGIN_SPECS.map((spec) => spec.login)],
        )
      ).rows[0]?.count,
    ).toBe(1);

    await admin!.query(`ALTER ROLE pracujbe_limiter NOINHERIT;
      REVOKE service_role FROM pracujbe_limiter`);
    expect((await provisionRuntimeLogins(admin!, environment())).changed).toBe(
      3,
    );
  });

  it("ponowienie niczego nie dodaje i verify wymaga dokładnie jednego członkostwa", async () => {
    expect((await provisionRuntimeLogins(admin!, environment())).changed).toBe(
      0,
    );
    await inspectRuntimeLogins(admin!, environment(), { requireAll: true });
    for (const spec of LOGIN_SPECS) {
      await expect(
        loginState(spec.login, initialPassword, spec.role),
      ).resolves.toEqual({ login: spec.login, role: spec.role });
    }

    await admin!.query("GRANT service_role TO pracujbe_web");
    await expect(
      inspectRuntimeLogins(admin!, environment(), { requireAll: true }),
    ).rejects.toThrow("niezgodne uprawnienia");
    await admin!.query("REVOKE service_role FROM pracujbe_web");

    await admin!.query("GRANT USAGE ON SCHEMA auth TO pracujbe_web");
    await expect(
      inspectRuntimeLogins(admin!, environment(), { requireAll: true }),
    ).rejects.toThrow("niezgodne uprawnienia");
    await admin!.query("REVOKE USAGE ON SCHEMA auth FROM pracujbe_web");

    await admin!.query(
      "CREATE SCHEMA runtime_login_illicit AUTHORIZATION pracujbe_web",
    );
    await expect(
      inspectRuntimeLogins(admin!, environment(), { requireAll: true }),
    ).rejects.toThrow("niezgodne uprawnienia");
    await admin!.query(`ALTER SCHEMA runtime_login_illicit OWNER TO postgres;
      DROP SCHEMA runtime_login_illicit`);

    await admin!.query("ALTER ROLE pracujbe_web REPLICATION");
    await expect(
      inspectRuntimeLogins(admin!, environment(), { requireAll: true }),
    ).rejects.toThrow("niezgodne uprawnienia");
    await admin!.query("ALTER ROLE pracujbe_web NOREPLICATION");

    await admin!.query("GRANT service_role TO pracujbe_auth");
    await expect(
      inspectRuntimeLogins(admin!, environment(), { requireAll: true }),
    ).rejects.toThrow("Role bazowe mają niezgodne członkostwa");
    await admin!.query("REVOKE service_role FROM pracujbe_auth");
  });

  it("rotuje cztery hasła atomowo i może zostać bezpiecznie ponowione", async () => {
    expect(
      (await rotateRuntimeLoginPasswords(admin!, environment())).changed,
    ).toBe(4);
    for (const spec of LOGIN_SPECS) {
      await expect(
        loginState(spec.login, initialPassword, spec.role),
      ).rejects.toBeTruthy();
      await expect(
        loginState(spec.login, rotatedPassword, spec.role),
      ).resolves.toEqual({ login: spec.login, role: spec.role });
    }
    expect(
      (await rotateRuntimeLoginPasswords(admin!, environment())).changed,
    ).toBe(4);
    await inspectRuntimeLogins(admin!, environment(), { requireAll: true });
  });
});

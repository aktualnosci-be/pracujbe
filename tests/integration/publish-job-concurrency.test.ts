import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadProductionMigrations } from "../../scripts/db/production-migrations.mjs";
import { applyMigrations } from "../../scripts/db/migrate.mjs";

const container = `pracujbe-publish-job-race-${randomUUID()}`;
const password = randomUUID();
const database = "publish_job_race_test";
const employerId = randomUUID();
const companyId = randomUUID();
const jobId = randomUUID();
let created = false;
let admin: Pool | undefined;
let connection: {
  host: string;
  port: number;
  password: string;
  database: string;
  user: string;
};

function docker(...args: string[]): string {
  const windows = process.platform === "win32";
  return execFileSync(
    windows ? "wsl.exe" : "docker",
    windows ? ["-d", "Ubuntu", "--", "docker", ...args] : args,
    { encoding: "utf8", timeout: 60_000 },
  ).trim();
}

async function insertCompleteDraft(id: string): Promise<void> {
  await admin!.query(
    `INSERT INTO public.jobs
      (id, company_id, slug, title, category, contract_type, city, region, status, default_locale)
    VALUES ($1, $2, $3, 'Operator produkcji', 'warehouse', 'permanent',
      'Antwerpia', 'Flandria', 'draft', 'pl')`,
    [id, companyId, `draft-${id}`],
  );
  await admin!.query(
    `INSERT INTO public.job_translations
      (job_id, locale, title, description, responsibilities)
    VALUES ($1, 'pl', 'Operator produkcji', 'Kompletny opis stanowiska.', ARRAY['Obsługa maszyn'])`,
    [id],
  );
  await admin!.query(
    `INSERT INTO public.job_requirements(job_id, locale, kind, position, content)
    VALUES ($1, 'pl', 'mandatory', 0, 'Dyspozycyjność')`,
    [id],
  );
}

async function authenticatedClient(applicationName: string): Promise<Client> {
  const client = new Client({
    ...connection,
    application_name: applicationName,
  });
  await client.connect();
  await client.query("BEGIN");
  await client.query("SET LOCAL statement_timeout = '10s'");
  await client.query("SET ROLE authenticated");
  await client.query(`SELECT set_config('app.current_uid', $1, true)`, [
    employerId,
  ]);
  return client;
}

async function waitUntilBothPublishersAreBlocked(
  applicationNames: string[],
): Promise<void> {
  const deadline = Date.now() + 5_000;
  let observed: Array<{
    application_name: string;
    state: string;
    wait_event_type: string | null;
    wait_event: string | null;
  }> = [];

  while (Date.now() < deadline) {
    observed = (
      await admin!.query(
        `SELECT application_name, state, wait_event_type, wait_event
           FROM pg_stat_activity
          WHERE application_name = ANY($1::text[])`,
        [applicationNames],
      )
    ).rows;
    if (
      observed.length === applicationNames.length &&
      observed.every(
        (session) =>
          session.state === "active" && session.wait_event_type === "Lock",
      )
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(
    `Obie publikacje nie czekały równolegle na blokadę: ${JSON.stringify(observed)}`,
  );
}

async function publish(client: Client, slug: string) {
  try {
    const startedAt = (
      await client.query<{ transaction_timestamp: Date }>(
        "SELECT transaction_timestamp() AS transaction_timestamp",
      )
    ).rows[0]!.transaction_timestamp;
    const result = await client.query<{ slug: string }>(
      "SELECT public.publish_job($1, $2) AS slug",
      [jobId, slug],
    );
    await client.query("COMMIT");
    return { ok: true as const, slug: result.rows[0]!.slug, startedAt };
  } catch (error) {
    await client.query("ROLLBACK");
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await client.end();
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
    `POSTGRES_PASSWORD=${password}`,
    "--env",
    `POSTGRES_DB=${database}`,
    "postgres:16",
  );
  created = true;
  const port = Number(docker("port", container, "5432/tcp").split(":").at(-1));
  if (!Number.isInteger(port) || port < 1)
    throw new Error("Brak portu izolowanej bazy.");
  connection = {
    host: "127.0.0.1",
    port,
    password,
    database,
    user: "postgres",
  };
  admin = new Pool({ ...connection, max: 3, connectionTimeoutMillis: 2_000 });
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      await admin.query("SELECT 1");
      ready = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  if (!ready) throw new Error("Izolowany PostgreSQL nie uruchomił się.");
  const migrator = await admin.connect();
  try {
    const migrations = await loadProductionMigrations();
    expect((await applyMigrations(migrator, migrations)).applied).toBe(
      migrations.length,
    );
  } finally {
    migrator.release();
  }

  await admin.query(
    `INSERT INTO auth.users(id, name, email, raw_user_meta_data)
    VALUES ($1, 'Jan Test', 'employer@example.invalid',
      '{"role":"employer","first_name":"Jan","last_name":"Test"}')`,
    [employerId],
  );
  await admin.query(
    `INSERT INTO public.companies(id, name, status) VALUES ($1, 'Firma testowa', 'verified')`,
    [companyId],
  );
  await admin.query(
    `INSERT INTO public.company_members(company_id, profile_id, role, is_active)
    VALUES ($1, $2, 'owner', true)`,
    [companyId, employerId],
  );
  await insertCompleteDraft(jobId);
});

afterAll(async () => {
  try {
    await admin?.end();
  } finally {
    if (created) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          docker("rm", "--force", container);
        } catch {
          /* weryfikacja poniżej */
        }
        if (
          !docker(
            "ps",
            "-a",
            "--filter",
            `name=^/${container}$`,
            "--format",
            "{{.Names}}",
          )
        )
          return;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      throw new Error("Nie udało się usunąć własnego kontenera testowego.");
    }
  }
});

describe("publish_job — równoległa publikacja na PostgreSQL 16", () => {
  it("dopuszcza dokładnie jednego zwycięzcę i zachowuje jego slug oraz czas transakcji", async () => {
    const applicationNames = [
      `publish-race-a-${randomUUID()}`,
      `publish-race-b-${randomUUID()}`,
    ];
    const locker = new Client({
      ...connection,
      application_name: `publish-race-locker-${randomUUID()}`,
    });
    await locker.connect();
    await locker.query("BEGIN");
    await locker.query("SELECT id FROM public.jobs WHERE id = $1 FOR UPDATE", [
      jobId,
    ]);

    const first = await authenticatedClient(applicationNames[0]!);
    const second = await authenticatedClient(applicationNames[1]!);
    const pendingResults = Promise.all([
      publish(first, "zwyciezca-a"),
      publish(second, "zwyciezca-b"),
    ]);
    let overlapError: unknown;
    try {
      await waitUntilBothPublishersAreBlocked(applicationNames);
    } catch (error) {
      overlapError = error;
    } finally {
      await locker.query("ROLLBACK");
      await locker.end();
    }

    const results = await pendingResults;
    if (overlapError) throw overlapError;
    const successes = results.filter((result) => result.ok);
    const failures = results.filter((result) => !result.ok);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0]!.message).toContain("VALIDATION_FAILED");

    const winner = successes[0]!;
    const stored = (
      await admin!.query<{ slug: string; published_at: Date; status: string }>(
        "SELECT slug, published_at, status::text FROM public.jobs WHERE id = $1",
        [jobId],
      )
    ).rows[0]!;
    expect(stored).toMatchObject({ slug: winner.slug, status: "active" });
    expect(stored.published_at.getTime()).toBe(winner.startedAt.getTime());
  });

  it("utrzymuje obie warstwy ochrony: blokadę wiersza i compare-and-swap", async () => {
    const definition = (
      await admin!.query<{ definition: string }>(
        `SELECT pg_get_functiondef('public.publish_job(uuid,text)'::regprocedure) AS definition`,
      )
    ).rows[0]!.definition;
    expect(definition).toMatch(/FOR UPDATE OF j/i);
    expect(definition).toMatch(/WHERE id = p_job_id AND status = 'draft'/i);
    expect(definition).toMatch(/IF NOT FOUND THEN[\s\S]*VALIDATION_FAILED/i);
  });
});

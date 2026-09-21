import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadProductionMigrations } from "../../scripts/db/production-migrations.mjs";
import { applyMigrations } from "../../scripts/db/migrate.mjs";
import { createRuntimePool } from "../../src/lib/db/pool";
import { withUserTransaction } from "../../src/lib/db/transaction";
import {
  createOwnCandidateCv,
  deleteOwnCandidateCv,
  getOwnDownloadableCv,
  listOwnCandidateFiles,
  type CreateCandidateCvInput,
} from "../../src/lib/db/candidate-files";

const container = `pracujbe-candidate-files-test-${randomUUID()}`;
const password = randomUUID();
const hash = "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81";
const legacyId = randomUUID();
let created = false;
let admin: Pool | undefined;
let app: Pool | undefined;
let owner: string;
let other: string;
const owners = new Map<string, string>();
const files = new Map<string, string>();
function docker(...args: string[]): string {
  const windows = process.platform === "win32";
  return execFileSync(
    windows ? "wsl.exe" : "docker",
    windows ? ["-d", "Ubuntu", "--", "docker", ...args] : args,
    { encoding: "utf8", timeout: 60_000 },
  ).trim();
}
async function createUser(role = "candidate") {
  const id = randomUUID();
  await admin!.query(
    `INSERT INTO auth.users(id,name,email,raw_user_meta_data)
    VALUES ($1,'Test CV',$2,$3::jsonb)`,
    [id, `${id}@example.invalid`, { role, locale: "pl" }],
  );
  return id;
}
function input(
  id: string,
  fields: Partial<CreateCandidateCvInput> = {},
): CreateCandidateCvInput {
  return {
    key: `${id}/cv-${randomUUID()}.pdf`,
    fileName: "Życiorys.pdf",
    mimeType: "application/pdf",
    sizeBytes: 3,
    scanStatus: "skipped",
    checksumSha256: hash,
    ...fields,
  };
}
interface FixtureOptions {
  scanStatus?: string;
  visibility?: string;
  entityType?: string;
  bucket?: string;
  deleted?: boolean;
  checksum?: string | null;
}
async function fixture(ownerId: string, options: FixtureOptions = {}) {
  const id = randomUUID();
  await admin!.query(
    `INSERT INTO public.files
    (id,owner_id,bucket,path,file_name,mime_type,size_bytes,entity_type,visibility,scan_status,deleted_at,checksum_sha256)
    VALUES ($1,$2,$3,$4,'Życiorys.pdf','application/pdf',3,$5,$6,$7,$8,$9)`,
    [
      id,
      ownerId,
      options.bucket ?? "candidate-files",
      `${ownerId}/cv-${randomUUID()}.pdf`,
      options.entityType ?? "candidate_cv",
      options.visibility ?? "private",
      options.scanStatus ?? "skipped",
      options.deleted ? new Date() : null,
      options.checksum === undefined ? hash : options.checksum,
    ],
  );
  return id;
}
beforeAll(async () => {
  // Własny jednorazowy klaster, losowy port i jawne połączenie; bez DATABASE_URL otoczenia.
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
    "POSTGRES_DB=candidate_files_test",
    "postgres:16",
  );
  created = true;
  const port = Number(docker("port", container, "5432/tcp").split(":").at(-1));
  if (!Number.isInteger(port) || port < 1)
    throw new Error("Brak portu izolowanej bazy.");
  admin = new Pool({
    host: "127.0.0.1",
    port,
    password,
    database: "candidate_files_test",
    user: "postgres",
    max: 1,
    connectionTimeoutMillis: 2_000,
  });
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
  const migrations = await loadProductionMigrations();
  const checksumIndex = migrations.findIndex(
    (migration) => migration.name === "0060_file_checksum.sql",
  );
  expect(checksumIndex).toBeGreaterThan(0);
  const migrator = await admin.connect();
  try {
    await applyMigrations(migrator, migrations.slice(0, checksumIndex));
  } finally {
    migrator.release();
  }
  // Rekord faktury sprzed 0060 musi przetrwać migrację bez wymyślonej checksumy.
  await admin.query(
    `INSERT INTO public.files(id,bucket,path,entity_type)
    VALUES ($1,'invoices','legacy.pdf','invoice')`,
    [legacyId],
  );
  const checksumMigrator = await admin.connect();
  try {
    expect((await applyMigrations(checksumMigrator, migrations)).applied).toBe(
      migrations.length - checksumIndex,
    );
    expect((await applyMigrations(checksumMigrator, migrations)).applied).toBe(
      0,
    );
  } finally {
    checksumMigrator.release();
  }
  await admin.query(`CREATE ROLE candidate_files_web LOGIN PASSWORD '${password}'
    NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
    GRANT pracujbe_app TO candidate_files_web;`);
  app = await createRuntimePool(
    `postgresql://candidate_files_web:${password}@127.0.0.1:${port}/candidate_files_test`,
    "domain",
  );
  owner = await createUser();
  other = await createUser();
  for (const state of ["employer", "admin", "inactive", "deleted", "missing"]) {
    const id =
      state === "missing"
        ? randomUUID()
        : await createUser(state === "employer" ? "employer" : "candidate");
    owners.set(state, id);
    if (state === "admin")
      await admin.query("UPDATE public.profiles SET role='admin' WHERE id=$1", [
        id,
      ]);
    if (state === "inactive")
      await admin.query(
        "UPDATE public.profiles SET is_active=false WHERE id=$1",
        [id],
      );
    if (state === "deleted")
      await admin.query(
        "UPDATE public.profiles SET deleted_at=now() WHERE id=$1",
        [id],
      );
    if (state !== "missing") files.set(state, await fixture(id));
  }
  for (const scanStatus of ["clean", "skipped", "pending", "infected"]) {
    files.set(scanStatus, await fixture(owner, { scanStatus }));
  }
  files.set("public", await fixture(owner, { visibility: "public" }));
  files.set("softDeleted", await fixture(owner, { deleted: true }));
  files.set("invoice", await fixture(owner, { entityType: "invoice" }));
  files.set("wrongBucket", await fixture(owner, { bucket: "invoices" }));
  files.set("otherPrivate", await fixture(other));
  files.set("otherPublic", await fixture(other, { visibility: "public" }));
});

afterAll(async () => {
  try {
    await app?.end();
  } finally {
    try {
      await admin?.end();
    } finally {
      if (created) {
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            docker("rm", "--force", container);
          } catch {
            /* Sprawdzamy własną nazwę poniżej. */
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
  }
});

describe("Metadane prywatnych CV — produkcyjne migracje i PostgreSQL 16", () => {
  it("migruje istniejącą fakturę z NULL i przyjmuje poprawną sumę SHA-256", async () => {
    expect(
      (
        await admin!.query(
          "SELECT checksum_sha256 FROM public.files WHERE id=$1",
          [legacyId],
        )
      ).rows,
    ).toEqual([{ checksum_sha256: null }]);
    await admin!.query(
      "UPDATE public.files SET checksum_sha256=$2 WHERE id=$1",
      [legacyId, hash],
    );
    expect(
      (
        await admin!.query(
          "SELECT checksum_sha256 FROM public.files WHERE id=$1",
          [legacyId],
        )
      ).rows,
    ).toEqual([{ checksum_sha256: hash }]);
    await admin!.query(
      "UPDATE public.files SET checksum_sha256=NULL WHERE id=$1",
      [legacyId],
    );
  });
  it.each([
    "",
    "a".repeat(63),
    "a".repeat(65),
    "A".repeat(64),
    "g".repeat(64),
    `${hash}\n`,
  ])("CHECK bazy odrzuca niepoprawną checksumę %j", async (invalid) => {
    await expect(
      admin!.query("UPDATE public.files SET checksum_sha256=$2 WHERE id=$1", [
        legacyId,
        invalid,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
  });
  it("listuje tylko własne aktywne CV i stan pobrania, bez kluczy obiektów", async () => {
    const result = await listOwnCandidateFiles(app!, owner);
    expect(result.map((row) => row.id).sort()).toEqual(
      ["clean", "skipped", "pending", "infected", "public"]
        .map((state) => files.get(state)!)
        .sort(),
    );
    for (const row of result) {
      expect(Object.keys(row).sort()).toEqual([
        "downloadable",
        "fileName",
        "id",
      ]);
      expect(row.fileName).toBe("Życiorys.pdf");
      expect(row.downloadable).toBe(
        !["pending", "infected"].some((state) => files.get(state) === row.id),
      );
    }
  });
  it.each(["clean", "skipped", "public"])(
    "udostępnia własny gotowy obiekt %s",
    async (state) => {
      const result = await getOwnDownloadableCv(app!, owner, files.get(state)!);
      expect(result).toMatchObject({
        id: files.get(state),
        ownerId: owner,
        bucket: "candidate-files",
        checksumSha256: hash,
        sizeBytes: 3,
        mimeType: "application/pdf",
      });
      expect(result!.key.startsWith(`${owner}/cv-`)).toBe(true);
    },
  );
  it.each([
    "pending",
    "infected",
    "softDeleted",
    "invoice",
    "wrongBucket",
    "otherPrivate",
    "otherPublic",
  ])("znany UUID nie odblokowuje pobrania %s", async (state) => {
    expect(
      await getOwnDownloadableCv(app!, owner, files.get(state)!),
    ).toBeNull();
  });
  it("ponownie sprawdza stan skanu przy każdym pobraniu", async () => {
    const id = await fixture(owner, { scanStatus: "skipped" });
    expect(await getOwnDownloadableCv(app!, owner, id)).not.toBeNull();
    await admin!.query(
      "UPDATE public.files SET scan_status='infected' WHERE id=$1",
      [id],
    );
    expect(await getOwnDownloadableCv(app!, owner, id)).toBeNull();
    await admin!.query("DELETE FROM public.files WHERE id=$1", [id]);
  });
  it("nie ufa publicznej widoczności nawet gdy obecne RLS pozwala SELECT", async () => {
    const direct = (await withUserTransaction(app!, other, (tx) =>
      tx.query("SELECT id FROM public.files WHERE id=$1", [
        files.get("public"),
      ]),
    )) as { rows: unknown[] };
    expect(direct.rows).toHaveLength(1);
    expect(
      await getOwnDownloadableCv(app!, other, files.get("public")!),
    ).toBeNull();
    expect(
      await deleteOwnCandidateCv(app!, other, files.get("public")!),
    ).toBeNull();
    expect(
      (await listOwnCandidateFiles(app!, other)).map((row) => row.id),
    ).not.toContain(files.get("public"));
  });
  it.each(["employer", "admin", "inactive", "deleted", "missing"])(
    "odmawia wszystkich operacji profilowi %s",
    async (state) => {
      const id = owners.get(state)!;
      const fileId = files.get(state) ?? files.get("clean")!;
      await expect(listOwnCandidateFiles(app!, id)).rejects.toMatchObject({
        code: "PERMISSION_DENIED",
      });
      await expect(
        getOwnDownloadableCv(app!, id, fileId),
      ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
      await expect(
        deleteOwnCandidateCv(app!, id, fileId),
      ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
      await expect(
        createOwnCandidateCv(app!, id, input(id)),
      ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    },
  );
  it("odmawia anonimowi także przy znanym UUID i prawidłowych danych", async () => {
    await expect(listOwnCandidateFiles(app!, null)).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
    await expect(
      getOwnDownloadableCv(app!, null, files.get("public")!),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(
      deleteOwnCandidateCv(app!, null, files.get("public")!),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(
      createOwnCandidateCv(app!, null, input(owner)),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });
  it("zapisuje stałe własności i hash, a identyfikator tworzy baza", async () => {
    const id = await createUser();
    const data = input(id, { sizeBytes: 5 * 1024 * 1024 });
    const createdFile = await createOwnCandidateCv(app!, id, data);
    expect(createdFile.id).toMatch(/^[a-f0-9-]{36}$/);
    expect(createdFile).toMatchObject({
      ...data,
      ownerId: id,
      bucket: "candidate-files",
    });
    expect(
      (
        await admin!.query(
          "SELECT owner_id,entity_type,visibility,entity_id,checksum_sha256 FROM public.files WHERE id=$1",
          [createdFile.id],
        )
      ).rows,
    ).toEqual([
      {
        owner_id: id,
        entity_type: "candidate_cv",
        visibility: "private",
        entity_id: null,
        checksum_sha256: hash,
      },
    ]);
    expect(await getOwnDownloadableCv(app!, id, createdFile.id)).toEqual(
      createdFile,
    );
  });
  it("nowy plik pending pozostaje w kwarantannie, ale właściciel może go usunąć", async () => {
    const id = await createUser();
    const createdFile = await createOwnCandidateCv(
      app!,
      id,
      input(id, { scanStatus: "pending" }),
    );
    expect(await getOwnDownloadableCv(app!, id, createdFile.id)).toBeNull();
    expect(await listOwnCandidateFiles(app!, id)).toEqual([
      { id: createdFile.id, fileName: "Życiorys.pdf", downloadable: false },
    ]);
    expect(await deleteOwnCandidateCv(app!, id, createdFile.id)).toEqual(
      createdFile,
    );
  });
  it.each([
    { sizeBytes: 0 },
    { sizeBytes: 5 * 1024 * 1024 + 1 },
    { sizeBytes: 1.5 },
    { fileName: "" },
    { fileName: " " },
    { fileName: "x".repeat(201) },
    { fileName: "CV\r\nInjected: 1" },
    { key: "../private.pdf" },
    { mimeType: "text/html" },
    { mimeType: "application/msword" },
    { scanStatus: "clean" },
    { scanStatus: "infected" },
    { checksumSha256: undefined },
    { checksumSha256: null },
    { checksumSha256: "" },
    { checksumSha256: "a".repeat(63) },
    { checksumSha256: "A".repeat(64) },
    { visibility: "public" },
    { owner_id: "client-picked" },
    { bucket: "invoices" },
    { entity_type: "invoice" },
  ])("odrzuca nieprawidłowe lub narzucone metadane %j", async (fields) => {
    const data = { ...input(owner), ...fields } as CreateCandidateCvInput;
    await expect(createOwnCandidateCv(app!, owner, data)).rejects.toMatchObject(
      { code: "VALIDATION_FAILED" },
    );
    expect(
      (
        await admin!.query("SELECT id FROM public.files WHERE path=$1", [
          data.key,
        ])
      ).rows,
    ).toHaveLength(0);
  });
  it("odrzuca klucz innej osoby, nie tworząc metadanych", async () => {
    const data = input(other);
    await expect(createOwnCandidateCv(app!, owner, data)).rejects.toMatchObject(
      { code: "VALIDATION_FAILED" },
    );
    expect(
      (
        await admin!.query("SELECT id FROM public.files WHERE path=$1", [
          data.key,
        ])
      ).rows,
    ).toHaveLength(0);
  });
  it.each(["not-a-uuid", "x'; DELETE FROM files; --"])(
    "odrzuca identyfikator %s",
    async (id) => {
      await expect(getOwnDownloadableCv(app!, owner, id)).rejects.toMatchObject(
        { code: "VALIDATION_FAILED" },
      );
      await expect(deleteOwnCandidateCv(app!, owner, id)).rejects.toMatchObject(
        { code: "VALIDATION_FAILED" },
      );
    },
  );
  it("DELETE RETURNING odcina dostęp i tylko raz zwraca metadane do usunięcia z S3", async () => {
    const id = await createUser();
    const file = await createOwnCandidateCv(app!, id, input(id));
    const results = await Promise.all([
      deleteOwnCandidateCv(app!, id, file.id),
      deleteOwnCandidateCv(app!, id, file.id),
    ]);
    expect(results.filter(Boolean)).toEqual([file]);
    expect(results.filter((value) => value === null)).toHaveLength(1);
    expect(await getOwnDownloadableCv(app!, id, file.id)).toBeNull();
    expect(await listOwnCandidateFiles(app!, id)).toEqual([]);
    expect(
      (await admin!.query("SELECT id FROM public.files WHERE id=$1", [file.id]))
        .rows,
    ).toHaveLength(0);
  });
  it.each([
    "softDeleted",
    "invoice",
    "wrongBucket",
    "otherPrivate",
    "otherPublic",
  ])("DELETE nie usuwa %s", async (state) => {
    expect(
      await deleteOwnCandidateCv(app!, owner, files.get(state)!),
    ).toBeNull();
    expect(
      (
        await admin!.query("SELECT id FROM public.files WHERE id=$1", [
          files.get(state),
        ])
      ).rows,
    ).toHaveLength(1);
  });
  it("odczytuje NULL checksumy legacy bez dorabiania hasha", async () => {
    const id = await fixture(owner, { checksum: null });
    expect(await getOwnDownloadableCv(app!, owner, id)).toMatchObject({
      checksumSha256: null,
    });
    await admin!.query("DELETE FROM public.files WHERE id=$1", [id]);
  });
  it("unikalność obiektu i awaria transakcji nie udają sukcesu ani nie ujawniają nazwy", async () => {
    const id = await createUser();
    const data = input(id, { fileName: "PII test-secret-key.pdf" });
    const first = await createOwnCandidateCv(app!, id, data);
    await expect(createOwnCandidateCv(app!, id, data)).rejects.toMatchObject({
      code: "INTERNAL",
      message: "INTERNAL",
    });
    expect(
      (
        await admin!.query("SELECT id FROM public.files WHERE path=$1", [
          data.key,
        ])
      ).rows,
    ).toEqual([{ id: first.id }]);
    expect(await getOwnDownloadableCv(app!, id, first.id)).toEqual(first);
  });
  it("błąd po INSERT wycofuje rekord i pozwala później zapisać", async () => {
    const id = await createUser();
    const data = input(id, { fileName: "Awaria.pdf" });
    await admin!
      .query(`CREATE FUNCTION public.cv_insert_failure_test() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'PII test-secret-key'; END $$;
      CREATE TRIGGER cv_insert_failure_test AFTER INSERT ON public.files
      FOR EACH ROW EXECUTE FUNCTION public.cv_insert_failure_test();`);
    try {
      await expect(createOwnCandidateCv(app!, id, data)).rejects.toMatchObject({
        code: "INTERNAL",
        message: "INTERNAL",
      });
      expect(
        (
          await admin!.query("SELECT id FROM public.files WHERE path=$1", [
            data.key,
          ])
        ).rows,
      ).toHaveLength(0);
    } finally {
      await admin!.query(
        "DROP TRIGGER cv_insert_failure_test ON public.files; DROP FUNCTION public.cv_insert_failure_test()",
      );
    }
    expect(await createOwnCandidateCv(app!, id, data)).toMatchObject({
      key: data.key,
    });
  });
  it("błąd COMMIT usunięcia nie zwraca klucza do S3 i przywraca rekord", async () => {
    const id = await createUser();
    const file = await createOwnCandidateCv(app!, id, input(id));
    await admin!
      .query(`CREATE FUNCTION public.cv_delete_commit_failure_test() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'PII test-secret-key'; END $$;
      CREATE CONSTRAINT TRIGGER cv_delete_commit_failure_test AFTER DELETE ON public.files
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.cv_delete_commit_failure_test();`);
    try {
      await expect(
        deleteOwnCandidateCv(app!, id, file.id),
      ).rejects.toMatchObject({ code: "INTERNAL", message: "INTERNAL" });
      expect(
        (
          await admin!.query("SELECT id FROM public.files WHERE id=$1", [
            file.id,
          ])
        ).rows,
      ).toEqual([{ id: file.id }]);
    } finally {
      await admin!.query(
        "DROP TRIGGER cv_delete_commit_failure_test ON public.files; DROP FUNCTION public.cv_delete_commit_failure_test()",
      );
    }
    expect(await getOwnDownloadableCv(app!, id, file.id)).toEqual(file);
    expect(await deleteOwnCandidateCv(app!, id, file.id)).toEqual(file);
  });
});

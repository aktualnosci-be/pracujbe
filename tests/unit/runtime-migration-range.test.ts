import { afterEach, describe, expect, it, vi } from "vitest";
import {
  describeNumbering,
  main as checkNumbering,
} from "../../scripts/db/check-migration-numbering.mjs";
import { assertExpectedMigrations } from "../../scripts/db/runtime-logins.mjs";

function migration(number: number, suffix = "change") {
  const prefix = String(number).padStart(4, "0");
  return {
    name:
      number === 0
        ? "0000_bootstrap_roles_and_identity.sql"
        : `${prefix}_${suffix}.sql`,
    sql: "select 1;",
    checksum: `checksum-${prefix}`,
  };
}

describe("ciąg migracji operatora loginów PostgreSQL", () => {
  it("akceptuje nowe końcowe migracje bez ręcznej aktualizacji zakresu", () => {
    const migrations = Array.from({ length: 64 }, (_, number) =>
      migration(number),
    );

    expect(assertExpectedMigrations(migrations)).toBe("0000..0063");
  });

  it("odrzuca lukę i duplikat numeru", () => {
    expect(() =>
      assertExpectedMigrations([
        migration(0),
        migration(1),
        migration(3),
      ]),
    ).toThrow("oczekiwano 0002, znaleziono 0003");

    expect(() =>
      assertExpectedMigrations([
        migration(0),
        migration(1),
        migration(1, "duplicate"),
      ]),
    ).toThrow("oczekiwano 0002, znaleziono 0001");
  });
});

/** #1246: osobny krok ciągłości numeracji w jobie „Migration runner”. */
describe("krok ciągłości numeracji migracji", () => {
  afterEach(() => vi.restoreAllMocks());

  it("ciągły zakres = kod 0 z zakresem w logu", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const migrations = Array.from({ length: 5 }, (_, number) => migration(number));
    expect(await checkNumbering(async () => migrations)).toBe(0);
    expect(log.mock.calls.flat().join(" ")).toContain("0000..0004");
    expect(describeNumbering(migrations)).toBeNull();
  });

  it("numer tymczasowy = kod 1 z nazwą migracji i wyjaśnieniem (kontrola ujemna)", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const migrations = [migration(0), migration(1), migration(2), migration(973, "temporary")];
    expect(await checkNumbering(async () => migrations)).toBe(1);
    const output = error.mock.calls.flat().join("\n");
    expect(output).toContain("oczekiwano 0003, znaleziono 0973");
    expect(output).toContain("0973_temporary.sql");
    expect(output).toContain("Numer tymczasowy");
    expect(describeNumbering(migrations)).toEqual({ expected: "0003", outOfRange: ["0973_temporary.sql"] });
  });
});

import { describe, expect, it } from "vitest";
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

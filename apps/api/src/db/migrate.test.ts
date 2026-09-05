import { describe, expect, it } from "vitest";
import { migrationChecksum, sortMigrationFiles } from "./migrate.js";

describe("sortMigrationFiles", () => {
  it("sorts migrations by numeric sequence instead of file name", () => {
    expect(
      sortMigrationFiles([
        "10_add_programs.sql",
        "README.md",
        "2_add_profiles.sql",
        "001_initial_auth.sql"
      ])
    ).toEqual([
      "001_initial_auth.sql",
      "2_add_profiles.sql",
      "10_add_programs.sql"
    ]);
  });

  it("rejects duplicate numeric sequences", () => {
    expect(() =>
      sortMigrationFiles(["1_initial.sql", "001_duplicate.sql"])
    ).toThrow("Duplicate migration sequence 1");
  });
});

describe("migrationChecksum", () => {
  it("does not change between LF and CRLF checkouts", () => {
    expect(migrationChecksum("SELECT 1;\r\nSELECT 2;\r\n")).toBe(
      migrationChecksum("SELECT 1;\nSELECT 2;\n")
    );
  });
});

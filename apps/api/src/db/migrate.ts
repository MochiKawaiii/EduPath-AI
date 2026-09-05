import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PoolClient } from "pg";
import type { DatabasePool } from "./pool.js";

const MIGRATION_LOCK_ID = 1_946_032_026;
const migrationsDirectory = fileURLToPath(
  new URL("../../migrations/", import.meta.url)
);

interface AppliedMigrationRow {
  checksum: string;
}

async function ensureMigrationTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(255) PRIMARY KEY,
      checksum CHAR(64) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

interface MigrationFile {
  sequence: number;
  version: string;
}

export function migrationChecksum(sql: string): string {
  const normalizedSql = sql.replace(/\r\n?/g, "\n");
  return createHash("sha256").update(normalizedSql).digest("hex");
}

export function sortMigrationFiles(fileNames: readonly string[]): string[] {
  const migrations = fileNames
    .map<MigrationFile | undefined>((version) => {
      const match = /^(\d+)_[a-z0-9_]+\.sql$/i.exec(version);
      if (!match?.[1]) {
        return undefined;
      }

      const sequence = Number(match[1]);
      if (!Number.isSafeInteger(sequence)) {
        throw new Error(`Invalid migration sequence in ${version}`);
      }

      return { sequence, version };
    })
    .filter((migration): migration is MigrationFile => migration !== undefined)
    .sort(
      (left, right) =>
        left.sequence - right.sequence || left.version.localeCompare(right.version)
    );

  for (let index = 1; index < migrations.length; index += 1) {
    if (migrations[index]?.sequence === migrations[index - 1]?.sequence) {
      throw new Error(
        `Duplicate migration sequence ${migrations[index]?.sequence}: ` +
          `${migrations[index - 1]?.version}, ${migrations[index]?.version}`
      );
    }
  }

  return migrations.map(({ version }) => version);
}

export async function runDatabaseMigrations(pool: DatabasePool): Promise<void> {
  const client = await pool.connect();
  let lockAcquired = false;
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
    lockAcquired = true;
    await ensureMigrationTable(client);

    const migrationFiles = sortMigrationFiles(await readdir(migrationsDirectory));

    for (const version of migrationFiles) {
      const sql = await readFile(join(migrationsDirectory, version), "utf8");
      const checksum = migrationChecksum(sql);
      const existing = await client.query<AppliedMigrationRow>(
        "SELECT checksum FROM schema_migrations WHERE version = $1",
        [version]
      );

      if (existing.rowCount) {
        if (existing.rows[0]?.checksum !== checksum) {
          throw new Error(`Applied migration ${version} has changed on disk`);
        }
        continue;
      }

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          `
            INSERT INTO schema_migrations (version, checksum)
            VALUES ($1, $2)
          `,
          [version, checksum]
        );
        await client.query("COMMIT");
        console.log(`[DATABASE] Applied migration ${version}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    try {
      if (lockAcquired) {
        await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]);
      }
    } finally {
      client.release();
    }
  }
}

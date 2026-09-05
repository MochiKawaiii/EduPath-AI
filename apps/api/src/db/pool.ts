import pg from "pg";
import type { AppConfig } from "../config.js";

const { Pool } = pg;

export type DatabasePool = InstanceType<typeof Pool>;

export function createDatabasePool(
  config: AppConfig["database"]
): DatabasePool {
  if (!config.url) {
    throw new Error("DATABASE_URL is required for PostgreSQL operations");
  }
  const pool = new Pool({
    connectionString: config.url,
    max: config.maxConnections,
    connectionTimeoutMillis: config.connectionTimeoutMs,
    idleTimeoutMillis: config.idleTimeoutMs
  });

  pool.on("error", (error) => {
    console.error(`[DATABASE] Unexpected idle client error (${error.name})`);
  });

  return pool;
}

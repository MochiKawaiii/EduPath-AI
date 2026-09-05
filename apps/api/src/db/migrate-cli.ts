import "dotenv/config";
import { loadConfig } from "../config.js";
import { runDatabaseMigrations } from "./migrate.js";
import { createDatabasePool } from "./pool.js";

const config = loadConfig();
const pool = createDatabasePool(config.database);

try {
  await runDatabaseMigrations(pool);
  console.log("[DATABASE] Migrations are up to date");
} finally {
  await pool.end();
}

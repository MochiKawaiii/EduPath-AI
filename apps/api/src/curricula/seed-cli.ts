import "dotenv/config";
import { loadConfig } from "../config.js";
import { createDatabasePool } from "../db/pool.js";
import { runDatabaseMigrations } from "../db/migrate.js";
import { seedCurricula } from "./seed.js";
const pool = createDatabasePool(loadConfig().database);
try {
  await runDatabaseMigrations(pool);
  await seedCurricula(pool);
  console.log(
    "Curricula K29, K30, K31 are synchronized. Existing revisions and statuses were preserved.",
  );
} finally {
  await pool.end();
}

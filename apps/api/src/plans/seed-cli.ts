import "dotenv/config";
import { loadConfig } from "../config.js";
import { createDatabasePool } from "../db/pool.js";
import { runDatabaseMigrations } from "../db/migrate.js";
import { seedCurricula } from "../curricula/seed.js";
import { seedPlans } from "./seed.js";

const pool = createDatabasePool(loadConfig().database);
try {
  await runDatabaseMigrations(pool);
  await seedCurricula(pool);
  await seedPlans(pool);
  console.log(
    "Training plans K29, K30, K31 synchronized. Existing revisions and statuses preserved.",
  );
} finally {
  await pool.end();
}

import "dotenv/config";
import { createApp } from "./app.js";
import { MsalMicrosoftAuthClient } from "./auth/microsoft-auth-client.js";
import { loadConfig } from "./config.js";
import { runDatabaseMigrations } from "./db/migrate.js";
import { createDatabasePool } from "./db/pool.js";
import { createPostgresSessionStore } from "./session/postgres-session-store.js";
import { PostgresUserRepository } from "./users/postgres-user-repository.js";

async function startServer(): Promise<void> {
  const config = loadConfig();
  const databasePool = createDatabasePool(config.database);

  try {
    if (config.database.autoMigrate) {
      await runDatabaseMigrations(databasePool);
    } else {
      await databasePool.query("SELECT 1");
    }

    const microsoftAuthClient = new MsalMicrosoftAuthClient(config);
    const userRepository = new PostgresUserRepository(databasePool);
    const sessionStore = createPostgresSessionStore(databasePool);
    const app = createApp({
      config,
      microsoftAuthClient,
      userRepository,
      sessionStore
    });

    const server = app.listen(config.port, () => {
      console.log(`EduPath API listening on http://localhost:${config.port}`);
    });

    const shutdown = (signal: string) => {
      console.log(`[SERVER] Received ${signal}; shutting down`);
      server.close(() => {
        void databasePool.end().finally(() => process.exit(0));
      });
    };

    process.once("SIGINT", () => shutdown("SIGINT"));
    process.once("SIGTERM", () => shutdown("SIGTERM"));
  } catch (error) {
    await databasePool.end().catch(() => undefined);
    throw error;
  }
}

try {
  await startServer();
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown startup error";
  console.error(`EduPath API could not start: ${message}`);
  process.exitCode = 1;
}

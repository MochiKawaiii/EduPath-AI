import "dotenv/config";
import { createApp } from "./app.js";
import { MsalMicrosoftAuthClient } from "./auth/microsoft-auth-client.js";
import { loadConfig } from "./config.js";
import { runDatabaseMigrations } from "./db/migrate.js";
import { createDatabasePool } from "./db/pool.js";
import { createPostgresSessionStore } from "./session/postgres-session-store.js";
import { PostgresUserRepository } from "./users/postgres-user-repository.js";
import { MemoryUserRepository } from "./users/memory-user-repository.js";

async function startServer(): Promise<void> {
  const config = loadConfig();
  const databasePool = config.database.url ? createDatabasePool(config.database) : undefined;

  try {
    if (databasePool && config.database.autoMigrate) {
      await runDatabaseMigrations(databasePool);
    } else if (databasePool) {
      await databasePool.query("SELECT 1");
    } else {
      console.log("[STORAGE] Preview mode: users and sessions are temporary (no DATABASE_URL)");
    }

    const microsoftAuthClient = new MsalMicrosoftAuthClient(config);
    const userRepository = databasePool
      ? new PostgresUserRepository(databasePool)
      : new MemoryUserRepository();
    const app = createApp({
      config,
      microsoftAuthClient,
      userRepository,
      ...(databasePool ? { sessionStore: createPostgresSessionStore(databasePool) } : {})
    });

    const server = app.listen(config.port, () => {
      console.log(`EduPath API listening on http://localhost:${config.port}`);
    });

    const shutdown = (signal: string) => {
      console.log(`[SERVER] Received ${signal}; shutting down`);
      server.close(() => {
        void (databasePool?.end() ?? Promise.resolve()).finally(() => process.exit(0));
      });
    };

    process.once("SIGINT", () => shutdown("SIGINT"));
    process.once("SIGTERM", () => shutdown("SIGTERM"));
  } catch (error) {
    await databasePool?.end().catch(() => undefined);
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

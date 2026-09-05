import connectPgSimple from "connect-pg-simple";
import session, { type Store } from "express-session";
import type { DatabasePool } from "../db/pool.js";

const PostgresSessionStore = connectPgSimple(session);

export function createPostgresSessionStore(pool: DatabasePool): Store {
  return new PostgresSessionStore({
    pool,
    tableName: "user_sessions",
    createTableIfMissing: false,
    pruneSessionInterval: 15 * 60
  });
}

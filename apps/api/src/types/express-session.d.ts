import "express-session";
import type {
  AuthenticatedUser,
  AuthTransaction
} from "../auth/types.js";

declare module "express-session" {
  interface SessionData {
    authTransactions?: AuthTransaction[];
    user?: AuthenticatedUser;
    // Kept out of AuthenticatedUser so /api/auth/me never returns it.
    logoutHint?: string;
  }
}

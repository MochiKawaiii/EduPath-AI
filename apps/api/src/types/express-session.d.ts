import "express-session";
import type {
  AuthenticatedUser,
  AuthTransaction
} from "../auth/types.js";

declare module "express-session" {
  interface SessionData {
    authTransactions?: AuthTransaction[];
    user?: AuthenticatedUser;
  }
}

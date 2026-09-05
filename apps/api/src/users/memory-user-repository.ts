import { randomUUID } from "node:crypto";
import { toAuthenticatedUser } from "../auth/security.js";
import type { AppRole, AuthenticatedUser, MicrosoftIdentity } from "../auth/types.js";
import type { UserRepository } from "./user-repository.js";

// Temporary, single-instance preview storage. No data survives a restart.
export class MemoryUserRepository implements UserRepository {
  private readonly users = new Map<string, AuthenticatedUser>();

  public async upsertMicrosoftUser(identity: MicrosoftIdentity, role: AppRole) {
    const key = `${identity.tenantId}:${identity.objectId}`;
    const previous = this.users.get(key);
    const user = toAuthenticatedUser(identity, role, previous?.userId ?? randomUUID());
    user.email ??= previous?.email ?? null;
    user.username ??= previous?.username ?? null;
    this.users.delete(key);
    // Bound the demo cache; evicted identities receive a new ID on their next login.
    if (this.users.size >= 1000) {
      const oldest = this.users.keys().next().value;
      if (oldest !== undefined) this.users.delete(oldest);
    }
    this.users.set(key, user);
    return { ...user };
  }
}

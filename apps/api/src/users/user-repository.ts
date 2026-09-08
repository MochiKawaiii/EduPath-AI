import type {
  AppRole,
  AuthenticatedUser,
  MicrosoftIdentity
} from "../auth/types.js";

export interface UserRepository {
  getRoleOverride(identity: MicrosoftIdentity): Promise<AppRole | null>;
  upsertMicrosoftUser(
    identity: MicrosoftIdentity,
    role: AppRole
  ): Promise<AuthenticatedUser>;
}

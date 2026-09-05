import type {
  AppRole,
  AuthenticatedUser,
  MicrosoftIdentity
} from "../auth/types.js";

export interface UserRepository {
  upsertMicrosoftUser(
    identity: MicrosoftIdentity,
    role: AppRole
  ): Promise<AuthenticatedUser>;
}

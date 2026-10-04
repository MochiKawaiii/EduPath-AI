-- Accounts may be provisioned by a verified administrator before Microsoft sign-in.
-- The real tenant/object identity is bound once, on the first successful sign-in.
ALTER TABLE users
  ALTER COLUMN entra_object_id DROP NOT NULL,
  ALTER COLUMN entra_subject DROP NOT NULL,
  ALTER COLUMN first_login_at DROP NOT NULL,
  ALTER COLUMN last_login_at DROP NOT NULL;

ALTER TABLE users ADD CONSTRAINT users_microsoft_identity_state_check CHECK (
  (entra_object_id IS NULL AND entra_subject IS NULL
    AND first_login_at IS NULL AND last_login_at IS NULL
    AND email IS NOT NULL AND username IS NOT NULL)
  OR
  (entra_object_id IS NOT NULL AND entra_subject IS NOT NULL
    AND first_login_at IS NOT NULL AND last_login_at IS NOT NULL)
);

CREATE UNIQUE INDEX users_pending_microsoft_username_idx
  ON users (entra_tenant_id, lower(btrim(username)))
  WHERE entra_object_id IS NULL;

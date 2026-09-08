ALTER TABLE users
  ADD COLUMN role_override VARCHAR(20)
    CONSTRAINT users_role_override_check CHECK (role_override IN ('student', 'admin'));

COMMENT ON COLUMN users.role_override IS
  'Explicit application role assigned in PostgreSQL. NULL uses Microsoft/default role. Applies on next sign-in.';

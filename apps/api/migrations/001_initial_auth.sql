CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  entra_tenant_id UUID NOT NULL,
  entra_object_id UUID NOT NULL,
  entra_subject TEXT NOT NULL,
  display_name VARCHAR(200) NOT NULL,
  email VARCHAR(320),
  username VARCHAR(320),
  role VARCHAR(20) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  first_login_at TIMESTAMPTZ NOT NULL,
  last_login_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT users_entra_identity_unique
    UNIQUE (entra_tenant_id, entra_object_id),
  CONSTRAINT users_role_check
    CHECK (role IN ('student', 'admin')),
  CONSTRAINT users_display_name_not_blank
    CHECK (btrim(display_name) <> '')
);

CREATE INDEX IF NOT EXISTS users_email_normalized_idx
  ON users (lower(email))
  WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS users_role_active_idx
  ON users (role, is_active);

CREATE TABLE IF NOT EXISTS student_profiles (
  user_id UUID PRIMARY KEY
    REFERENCES users(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,
  student_code VARCHAR(32) UNIQUE,
  cohort_year SMALLINT,
  current_semester SMALLINT,
  career_goal TEXT,
  onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT student_profiles_student_code_not_blank
    CHECK (student_code IS NULL OR btrim(student_code) <> ''),
  CONSTRAINT student_profiles_cohort_year_check
    CHECK (cohort_year IS NULL OR cohort_year BETWEEN 2000 AND 2100),
  CONSTRAINT student_profiles_current_semester_check
    CHECK (current_semester IS NULL OR current_semester BETWEEN 1 AND 20)
);

CREATE TABLE IF NOT EXISTS user_sessions (
  sid VARCHAR NOT NULL PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMP(6) WITHOUT TIME ZONE NOT NULL
);

CREATE INDEX IF NOT EXISTS user_sessions_expire_idx
  ON user_sessions (expire);

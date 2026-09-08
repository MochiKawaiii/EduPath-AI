ALTER TABLE users ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 0;

CREATE TABLE login_events (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  tenant_id UUID NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  outcome VARCHAR(16) NOT NULL CHECK (outcome IN ('success', 'denied')),
  reason VARCHAR(64) NOT NULL,
  portal VARCHAR(16) NOT NULL CHECK (portal IN ('admin', 'student'))
);
CREATE INDEX login_events_tenant_time_idx ON login_events(tenant_id, occurred_at DESC, id);
CREATE INDEX login_events_user_time_idx ON login_events(user_id, occurred_at DESC, id);

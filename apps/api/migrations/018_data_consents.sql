-- Evidence of each student's consent to personal-data processing (Luật Bảo vệ dữ liệu cá nhân
-- 91/2025/QH15, Nghị định 356/2025/NĐ-CP): who agreed, to which purpose and policy version,
-- when, and when it ended (withdrawn by the student, or superseded by consent to a newer
-- policy version). Rows are removed with the account.
CREATE TABLE public.data_consents (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('transcript_processing')),
  policy_version CHAR(10) NOT NULL CHECK (policy_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at TIMESTAMPTZ,
  end_reason TEXT CHECK (end_reason IN ('withdrawn', 'superseded')),
  CHECK ((ended_at IS NULL) = (end_reason IS NULL)),
  CHECK (ended_at IS NULL OR ended_at >= granted_at)
);
CREATE UNIQUE INDEX data_consents_one_active ON public.data_consents(user_id, purpose) WHERE ended_at IS NULL;
CREATE INDEX data_consents_history ON public.data_consents(user_id, granted_at DESC);
ALTER TABLE public.data_consents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.data_consents FROM PUBLIC;
DO $$ DECLARE r TEXT; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('REVOKE ALL ON public.data_consents FROM %I',r);
    END IF;
  END LOOP;
END $$;

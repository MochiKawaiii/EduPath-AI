ALTER TABLE public.student_profiles ADD COLUMN interests TEXT;
CREATE TABLE public.student_transcripts (
  user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  version UUID NOT NULL,
  filename VARCHAR(200) NOT NULL,
  pdf_data BYTEA NOT NULL,
  file_size INTEGER NOT NULL CHECK (file_size > 0 AND file_size <= 5242880),
  sha256 CHAR(64) NOT NULL,
  parsed_data JSONB NOT NULL CHECK (jsonb_typeof(parsed_data) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE public.student_transcripts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.student_transcripts FROM PUBLIC;
DO $$
DECLARE api_role TEXT;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON public.student_transcripts FROM %I', api_role);
    END IF;
  END LOOP;
END;
$$;

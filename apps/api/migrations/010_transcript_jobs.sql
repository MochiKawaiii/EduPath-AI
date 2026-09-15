CREATE TABLE public.transcript_jobs (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  filename VARCHAR(200) NOT NULL,
  pdf_data BYTEA,
  expected_version UUID,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','completed','failed','cancelled')),
  lease_token UUID,
  lease_until TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (pdf_data IS NULL OR octet_length(pdf_data) BETWEEN 8 AND 5242880)
);
CREATE UNIQUE INDEX transcript_jobs_one_pending ON public.transcript_jobs(user_id) WHERE status IN ('queued','processing');
CREATE INDEX transcript_jobs_queue ON public.transcript_jobs(status,created_at);
CREATE TABLE public.transcript_worker_status (id INTEGER PRIMARY KEY CHECK(id=1), seen_at TIMESTAMPTZ NOT NULL);
ALTER TABLE public.transcript_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transcript_worker_status ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.transcript_jobs, public.transcript_worker_status FROM PUBLIC;
DO $$ DECLARE r TEXT; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('REVOKE ALL ON public.transcript_jobs, public.transcript_worker_status FROM %I',r);
    END IF;
  END LOOP;
END $$;

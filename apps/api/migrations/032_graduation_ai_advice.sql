-- AI advice on the student graduation page ("Lời khuyên từ EduPath AI"). A row is both the worker
-- job (kind "graduation_advice", served by /api/worker/competency-assessments) and the stored
-- advice. The model only receives academic facts computed by the server (no name, student code,
-- email, class, interests or PDF); staff never read these rows.
-- Retention: the API keeps the 5 newest rows per student, deletes all of them when the student
-- replaces or deletes the transcript, and clears ai_input as soon as a job ends.
CREATE TABLE public.stu_grad_advice (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  transcript_version UUID NOT NULL,
  standard_id UUID NOT NULL,
  standard_revision_id UUID NOT NULL,
  standard_version INTEGER NOT NULL,
  calc_version TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','completed','failed','cancelled')),
  lease_token UUID, lease_until TIMESTAMPTZ, attempts INTEGER NOT NULL DEFAULT 0,
  ai_input JSONB, ai_output JSONB, error_code TEXT, metrics JSONB,
  ai_model TEXT, ai_model_digest TEXT, ollama_version TEXT, prompt_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), completed_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX stu_grad_advice_one_pending ON public.stu_grad_advice(user_id) WHERE status IN ('queued','processing');
CREATE INDEX stu_grad_advice_queue ON public.stu_grad_advice(status, created_at);
CREATE INDEX stu_grad_advice_recent ON public.stu_grad_advice(user_id, created_at DESC, id);
ALTER TABLE public.stu_grad_advice ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stu_grad_advice FROM PUBLIC;
DO $$ DECLARE r TEXT; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('REVOKE ALL ON public.stu_grad_advice FROM %I',r);
    END IF;
  END LOOP;
END $$;

-- Student competency assessments (STU-COMP, STU-GAP, STU-CAREER-05). A result is kept until the
-- student deletes or replaces the transcript or withdraws consent; the API keeps the 20 newest
-- per student and never deletes results by age. AI jobs are temporary: ai_input is cleared when
-- a job ends and finished jobs are removed after 7 days.
CREATE TABLE public.stu_comp_assessments (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  transcript_version UUID NOT NULL,
  meta JSONB NOT NULL,
  computed JSONB NOT NULL,
  ai_status TEXT NOT NULL CHECK (ai_status IN ('disabled','deferred','queued','processing','completed','failed','cancelled')),
  ai_output JSONB,
  ai_model TEXT,
  ai_model_digest TEXT,
  ollama_version TEXT,
  prompt_version TEXT,
  ai_error_code TEXT,
  ai_completed_at TIMESTAMPTZ
);
CREATE INDEX stu_comp_assessments_user_recent ON public.stu_comp_assessments(user_id, created_at DESC, id);
CREATE TABLE public.stu_comp_ai_jobs (
  id UUID PRIMARY KEY,
  assessment_id UUID NOT NULL REFERENCES public.stu_comp_assessments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','completed','failed','cancelled')),
  lease_token UUID,
  lease_until TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  ai_input JSONB,
  error_code TEXT,
  metrics JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX stu_comp_ai_jobs_one_pending ON public.stu_comp_ai_jobs(user_id) WHERE status IN ('queued','processing');
CREATE INDEX stu_comp_ai_jobs_queue ON public.stu_comp_ai_jobs(status, created_at);
CREATE TABLE public.stu_comp_ai_worker_status (id INTEGER PRIMARY KEY CHECK (id=1), seen_at TIMESTAMPTZ NOT NULL);
ALTER TABLE public.stu_comp_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stu_comp_ai_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stu_comp_ai_worker_status ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stu_comp_assessments, public.stu_comp_ai_jobs, public.stu_comp_ai_worker_status FROM PUBLIC;
DO $$ DECLARE r TEXT; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('REVOKE ALL ON public.stu_comp_assessments, public.stu_comp_ai_jobs, public.stu_comp_ai_worker_status FROM %I',r);
    END IF;
  END LOOP;
END $$;

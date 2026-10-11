-- AI skill suggestions for career positions (AD-REQ "Tạo liên kết kỹ năng với nghề nghiệp (AI)").
-- A row is both the worker job and the audit record: ai_input is cleared when the job ends, while
-- the validated result, model info and what the admin finally saved are kept for review and metrics.
-- Workers advertise the job kinds they support in stu_comp_ai_worker_status.kinds; an old worker
-- that sends no kinds keeps the default and never receives career jobs.
CREATE TABLE public.career_ai_suggestions (
  id UUID PRIMARY KEY,
  career_position_id UUID NOT NULL REFERENCES public.career_positions(id) ON DELETE CASCADE,
  requested_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','completed','failed','cancelled')),
  lease_token UUID, lease_until TIMESTAMPTZ, attempts INTEGER NOT NULL DEFAULT 0,
  ai_input JSONB, result JSONB, error_code TEXT, metrics JSONB,
  ai_model TEXT, ai_model_digest TEXT, ollama_version TEXT, prompt_version TEXT,
  applied_at TIMESTAMPTZ, applied_by UUID REFERENCES public.users(id) ON DELETE SET NULL, applied_summary JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), completed_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX career_ai_suggestions_one_pending ON public.career_ai_suggestions(career_position_id) WHERE status IN ('queued','processing');
CREATE INDEX career_ai_suggestions_queue ON public.career_ai_suggestions(status, created_at);
CREATE INDEX career_ai_suggestions_recent ON public.career_ai_suggestions(career_position_id, created_at DESC);
ALTER TABLE public.stu_comp_ai_worker_status ADD COLUMN kinds TEXT[] NOT NULL DEFAULT ARRAY['competency_assessment']::text[];
ALTER TABLE public.career_ai_suggestions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.career_ai_suggestions FROM PUBLIC;
DO $$ DECLARE r TEXT; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('REVOKE ALL ON public.career_ai_suggestions FROM %I',r);
    END IF;
  END LOOP;
END $$;

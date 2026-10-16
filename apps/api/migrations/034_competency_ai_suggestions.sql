-- AD-COMP function list ver0.2 (7).
-- 1. "Xóa nhóm kỹ năng đánh giá": a group is soft-deleted (deleted_at, is_active=false) once no live
--    skill profile uses it, so the history and the soft-deleted profiles that point to it stay valid.
--    The name of a deleted group can be used again.
-- 2. AI proposals for the courses of a CTĐT revision: "Tạo liên kết kỹ năng với học phần (AI)" (mode
--    links), "Thêm trọng số năng lực (AI)" (mode weights) and the whole-program run (mode full: links
--    with weights, grouped by batch_id). A row is both the worker job and the audit record, like
--    career_ai_suggestions: ai_input is cleared when the job ends, and nothing is written to the
--    ad_comp_course_* tables until an admin applies a proposal.
ALTER TABLE public.ad_comp_groups ADD COLUMN deleted_at TIMESTAMPTZ;
DROP INDEX IF EXISTS public.ad_comp_groups_name;
CREATE UNIQUE INDEX ad_comp_groups_name_live ON public.ad_comp_groups(lower(name)) WHERE deleted_at IS NULL;

CREATE TABLE public.ad_comp_ai_suggestions (
  id UUID PRIMARY KEY,
  revision_id UUID NOT NULL,
  course_code TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('links','weights','full')),
  batch_id UUID,
  requested_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','completed','failed','cancelled')),
  lease_token UUID, lease_until TIMESTAMPTZ, attempts INTEGER NOT NULL DEFAULT 0,
  ai_input JSONB, result JSONB, error_code TEXT, metrics JSONB,
  ai_model TEXT, ai_model_digest TEXT, ollama_version TEXT, prompt_version TEXT,
  applied_at TIMESTAMPTZ, applied_by UUID REFERENCES public.users(id) ON DELETE SET NULL, applied_summary JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), completed_at TIMESTAMPTZ,
  FOREIGN KEY (revision_id, course_code) REFERENCES public.curriculum_courses(revision_id, code)
);
CREATE UNIQUE INDEX ad_comp_ai_one_pending ON public.ad_comp_ai_suggestions(revision_id, course_code, mode) WHERE status IN ('queued','processing');
CREATE INDEX ad_comp_ai_queue ON public.ad_comp_ai_suggestions(status, created_at);
CREATE INDEX ad_comp_ai_recent ON public.ad_comp_ai_suggestions(revision_id, course_code, mode, created_at DESC);
CREATE INDEX ad_comp_ai_batch ON public.ad_comp_ai_suggestions(batch_id, course_code) WHERE batch_id IS NOT NULL;
ALTER TABLE public.ad_comp_ai_suggestions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ad_comp_ai_suggestions FROM PUBLIC;
DO $$ DECLARE r TEXT; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('REVOKE ALL ON public.ad_comp_ai_suggestions FROM %I',r);
    END IF;
  END LOOP;
END $$;

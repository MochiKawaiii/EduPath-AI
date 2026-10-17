-- "Thêm kỹ năng đánh giá (AI)": the AI reads the courses of a CTĐT revision and proposes skills for
-- the competency catalog (career skills that no profile covers yet, and new skills). Such a proposal
-- belongs to the whole revision, so it has no course: mode 'skills' and only that mode has a NULL
-- course_code (the composite foreign key is not checked for it). One pending proposal per revision.
ALTER TABLE public.ad_comp_ai_suggestions ALTER COLUMN course_code DROP NOT NULL;
ALTER TABLE public.ad_comp_ai_suggestions DROP CONSTRAINT ad_comp_ai_suggestions_mode_check;
ALTER TABLE public.ad_comp_ai_suggestions ADD CONSTRAINT ad_comp_ai_suggestions_mode_check
  CHECK (mode IN ('links','weights','full','skills') AND ((mode='skills') = (course_code IS NULL)));
CREATE UNIQUE INDEX ad_comp_ai_one_pending_skills ON public.ad_comp_ai_suggestions(revision_id)
  WHERE mode='skills' AND status IN ('queued','processing');

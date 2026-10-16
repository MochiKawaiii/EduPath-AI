-- Competency assessment "AI 100%" (comp-ai-v1). When the API server has ANTHROPIC_API_KEY, the numbers a
-- student sees on "Đánh giá năng lực" and "Khoảng trống kỹ năng" are computed by Claude Haiku 5.5 through
-- Anthropic's API (policy 2026-10-16, mandatory consent). The engine result stays in `computed` (term
-- history, plan progress, course facts, prompt source); `ai_scoring` holds the model's validated numbers
-- and `scoring_mode` tells the two kinds of assessment apart. Jobs of that mode run inside the API server
-- (runner 'cloud'); the laptop worker only claims runner 'worker' jobs.
ALTER TABLE public.stu_comp_ai_jobs
  ADD COLUMN runner TEXT NOT NULL DEFAULT 'worker' CHECK (runner IN ('worker','cloud'));
ALTER TABLE public.stu_comp_assessments
  ADD COLUMN scoring_mode TEXT NOT NULL DEFAULT 'system' CHECK (scoring_mode IN ('system','ai')),
  ADD COLUMN ai_scoring JSONB;
CREATE INDEX stu_comp_ai_jobs_runner_queue ON public.stu_comp_ai_jobs(runner, status, created_at);

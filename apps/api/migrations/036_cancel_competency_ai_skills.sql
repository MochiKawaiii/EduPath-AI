-- "Thêm kỹ năng đánh giá (AI)" (mode 'skills', migration 035) was removed on 2026-10-17 at the
-- user's request. Its pending proposals are cancelled so no worker runs them; finished ones stay as
-- the audit record. The 'skills' value of the mode check and the nullable course_code stay, because
-- 035 is already applied in production.
UPDATE public.ad_comp_ai_suggestions SET status='cancelled',ai_input=NULL,lease_token=NULL,lease_until=NULL,updated_at=now()
  WHERE mode='skills' AND status IN ('queued','processing');

-- A semester is a term within an academic year, not a cumulative term number.
-- Old values outside 1..3 cannot be converted without knowing the academic year.
UPDATE public.student_profiles
SET current_semester = NULL, updated_at = CURRENT_TIMESTAMP
WHERE current_semester NOT BETWEEN 1 AND 3;

ALTER TABLE public.student_profiles
  DROP CONSTRAINT student_profiles_current_semester_check;
ALTER TABLE public.student_profiles
  ADD CONSTRAINT student_profiles_current_semester_check
  CHECK (current_semester IS NULL OR current_semester BETWEEN 1 AND 3);

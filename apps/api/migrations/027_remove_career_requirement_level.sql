-- Proficiency levels are no longer part of career requirements.
-- Keep requirement IDs, skill links, priority, and course weights intact.
-- No CASCADE: unexpected dependencies must fail rather than be silently removed.
ALTER TABLE public.career_requirements DROP COLUMN level;

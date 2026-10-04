ALTER TABLE public.career_skills
 ADD COLUMN description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 2000),
 ADD COLUMN version UUID NOT NULL DEFAULT gen_random_uuid(),
 ADD COLUMN deleted_at TIMESTAMPTZ,
 ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
DROP INDEX public.career_skills_names;
CREATE UNIQUE INDEX career_skills_names ON public.career_skills(lower(name)) WHERE deleted_at IS NULL;

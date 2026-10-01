CREATE TABLE public.career_skills (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 100),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX career_skills_names ON public.career_skills(lower(name));
CREATE TABLE public.career_requirements (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 career_position_id UUID NOT NULL REFERENCES public.career_positions(id),
 skill_id UUID REFERENCES public.career_skills(id),
 title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 160),
 description TEXT NOT NULL DEFAULT '',
 level TEXT NOT NULL DEFAULT 'unspecified' CHECK(level IN ('unspecified','basic','intermediate','advanced')),
 is_required BOOLEAN NOT NULL DEFAULT false,
 version UUID NOT NULL DEFAULT gen_random_uuid(), deleted_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX career_requirements_skill_link ON public.career_requirements(career_position_id,skill_id)
 WHERE deleted_at IS NULL AND skill_id IS NOT NULL;
CREATE INDEX career_requirements_position ON public.career_requirements(career_position_id) WHERE deleted_at IS NULL;
INSERT INTO public.career_skills(name)
 SELECT DISTINCT ON(lower(trim(skill))) trim(skill)
 FROM public.career_positions p CROSS JOIN LATERAL unnest(p.skills) skill
 WHERE length(trim(skill)) BETWEEN 1 AND 100 ORDER BY lower(trim(skill)),trim(skill);
-- Existing skill names are references, so do not invent a required proficiency.
INSERT INTO public.career_requirements(career_position_id,skill_id,title)
 SELECT DISTINCT p.id,s.id,s.name
 FROM public.career_positions p CROSS JOIN LATERAL unnest(p.skills) skill
 JOIN public.career_skills s ON lower(s.name)=lower(trim(skill));
ALTER TABLE public.career_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.career_requirements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.career_skills,public.career_requirements FROM PUBLIC;
DO $$ DECLARE role_name TEXT; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON public.career_skills,public.career_requirements FROM %I',role_name);
  END IF;
 END LOOP;
END $$;

CREATE TABLE public.curricula (
  id UUID PRIMARY KEY, identity_key TEXT NOT NULL UNIQUE, cohort_code TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE, current_revision UUID, lock_version UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE public.curriculum_revisions (
  id UUID PRIMARY KEY, curriculum_id UUID NOT NULL REFERENCES public.curricula(id),
  version INTEGER NOT NULL CHECK(version>0), data JSONB NOT NULL,
  source_filename TEXT NOT NULL, source_data BYTEA NOT NULL CHECK(octet_length(source_data)<=5242880), source_sha256 TEXT NOT NULL,
  actor_id UUID REFERENCES public.users(id) ON DELETE SET NULL, change_note TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(curriculum_id,version), UNIQUE(curriculum_id,id)
);
ALTER TABLE public.curricula ADD FOREIGN KEY(id,current_revision) REFERENCES public.curriculum_revisions(curriculum_id,id);
CREATE TABLE public.course_catalog (code TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE public.curriculum_courses (
  revision_id UUID NOT NULL REFERENCES public.curriculum_revisions(id), code TEXT NOT NULL REFERENCES public.course_catalog(code),
  position INTEGER NOT NULL, name TEXT NOT NULL, credits NUMERIC NOT NULL CHECK(credits BETWEEN 0 AND 30),
  course_type TEXT NOT NULL, semester INTEGER CHECK(semester BETWEEN 1 AND 3), study_year INTEGER CHECK(study_year BETWEEN 1 AND 10),
  block TEXT NOT NULL, specialty TEXT NOT NULL, data JSONB NOT NULL, PRIMARY KEY(revision_id,code)
);
CREATE TABLE public.curriculum_relations (
  revision_id UUID NOT NULL, course_code TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('prerequisite','prior')),
  raw TEXT NOT NULL, target_codes TEXT[] NOT NULL, unresolved_codes TEXT[] NOT NULL, review_required BOOLEAN NOT NULL,
  PRIMARY KEY(revision_id,course_code,kind), FOREIGN KEY(revision_id,course_code) REFERENCES public.curriculum_courses(revision_id,code)
);
CREATE TABLE public.curriculum_events (
  id BIGSERIAL PRIMARY KEY, curriculum_id UUID NOT NULL REFERENCES public.curricula(id),
  actor_id UUID REFERENCES public.users(id) ON DELETE SET NULL, action TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX curriculum_courses_code ON public.curriculum_courses(code);
DO $$ DECLARE t TEXT; r TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['curricula','curriculum_revisions','course_catalog','curriculum_courses','curriculum_relations','curriculum_events'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',t);
    FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON public.%I FROM %I',t,r); END IF;
    END LOOP;
  END LOOP;
END $$;

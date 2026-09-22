CREATE TABLE public.graduation_standards (
  id UUID PRIMARY KEY, identity_key TEXT NOT NULL UNIQUE,
  cohort_code TEXT NOT NULL, is_active BOOLEAN NOT NULL DEFAULT TRUE,
  current_revision UUID, lock_version UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE public.graduation_revisions (
  id UUID PRIMARY KEY, standard_id UUID NOT NULL REFERENCES public.graduation_standards(id),
  version INTEGER NOT NULL CHECK(version>0), data JSONB NOT NULL,
  source_filename TEXT NOT NULL, source_data BYTEA NOT NULL CHECK(octet_length(source_data)<=5242880),
  actor_id UUID REFERENCES public.users(id) ON DELETE SET NULL, change_note TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(standard_id,version), UNIQUE(standard_id,id)
);
ALTER TABLE public.graduation_standards ADD FOREIGN KEY(id,current_revision) REFERENCES public.graduation_revisions(standard_id,id);
CREATE TABLE public.graduation_courses (
  revision_id UUID NOT NULL REFERENCES public.graduation_revisions(id),
  item_id TEXT NOT NULL, group_id TEXT NOT NULL, code TEXT NOT NULL,
  credits NUMERIC CHECK(credits BETWEEN 0 AND 50), condition_only BOOLEAN NOT NULL,
  data JSONB NOT NULL, PRIMARY KEY(revision_id,item_id)
);
CREATE INDEX graduation_courses_code ON public.graduation_courses(code);
CREATE TABLE public.graduation_events (
  id BIGSERIAL PRIMARY KEY, standard_id UUID NOT NULL REFERENCES public.graduation_standards(id),
  actor_id UUID REFERENCES public.users(id) ON DELETE SET NULL, action TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
DO $$ DECLARE t TEXT; r TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['graduation_standards','graduation_revisions','graduation_courses','graduation_events'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',t);
    FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON public.%I FROM %I',t,r); END IF;
    END LOOP;
  END LOOP;
END $$;

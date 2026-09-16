CREATE TABLE public.training_plans (
  id UUID PRIMARY KEY, identity_key TEXT NOT NULL UNIQUE, cohort_code TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE, current_revision UUID, lock_version UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE public.training_plan_revisions (
  id UUID PRIMARY KEY, plan_id UUID NOT NULL REFERENCES public.training_plans(id),
  version INTEGER NOT NULL CHECK(version>0), data JSONB NOT NULL,
  curriculum_revision_id UUID REFERENCES public.curriculum_revisions(id),
  source_filename TEXT NOT NULL, source_data BYTEA NOT NULL CHECK(octet_length(source_data)<=5242880), source_sha256 TEXT NOT NULL,
  actor_id UUID REFERENCES public.users(id) ON DELETE SET NULL, change_note TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(plan_id,version), UNIQUE(plan_id,id)
);
ALTER TABLE public.training_plans ADD FOREIGN KEY(id,current_revision) REFERENCES public.training_plan_revisions(plan_id,id);
CREATE TABLE public.training_plan_items (
  revision_id UUID NOT NULL REFERENCES public.training_plan_revisions(id), item_id TEXT NOT NULL,
  position INTEGER NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL, credits NUMERIC CHECK(credits BETWEEN 0 AND 30),
  term_code TEXT NOT NULL, semester INTEGER NOT NULL CHECK(semester BETWEEN 1 AND 3), study_year INTEGER NOT NULL CHECK(study_year BETWEEN 1 AND 10),
  section_id TEXT NOT NULL, data JSONB NOT NULL, PRIMARY KEY(revision_id,item_id)
);
CREATE INDEX training_plan_items_code ON public.training_plan_items(code);
CREATE TABLE public.training_plan_events (
  id BIGSERIAL PRIMARY KEY, plan_id UUID NOT NULL REFERENCES public.training_plans(id),
  actor_id UUID REFERENCES public.users(id) ON DELETE SET NULL, action TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
DO $$ DECLARE t TEXT; r TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['training_plans','training_plan_revisions','training_plan_items','training_plan_events'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',t);
    FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON public.%I FROM %I',t,r); END IF;
    END LOOP;
  END LOOP;
END $$;

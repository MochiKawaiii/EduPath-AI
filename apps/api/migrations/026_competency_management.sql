-- Incremental AD-COMP setup. Migration025 is absent from this checkout because
-- its applied source was not retained; the stored migration history is preserved.
-- This migration creates a fresh module or adopts the verified seven-table025 schema.
-- Never alter prototype competency_* tables or replace their function definitions.
-- Match API lock ordering before taking schema/table locks during adoption.
SELECT pg_advisory_xact_lock(1946032027);

-- Refuse unrelated/partial tables rather than silently adopting their namespace.
DO $$ DECLARE expected RECORD; specification TEXT; attribute_name TEXT; attribute_type TEXT; relation_oid OID; BEGIN
 IF (SELECT count(*) FROM unnest(ARRAY['ad_comp_groups','ad_comp_skills','ad_comp_course_configs','ad_comp_course_links','ad_comp_events','ad_comp_import_aliases','ad_comp_imports']) table_name
   WHERE to_regclass(format('public.%I',table_name)) IS NOT NULL) NOT IN (0,7) THEN
   RAISE EXCEPTION 'AD-COMP table shape mismatch: incomplete existing module';
 END IF;
 FOR expected IN SELECT * FROM (VALUES
 ('ad_comp_groups',ARRAY['id:uuid:!','name:text:!','description:text:!','is_active:boolean:!','version:uuid:!','source_key:text','created_at:timestamp with time zone:!','updated_at:timestamp with time zone:!']),
 ('ad_comp_skills',ARRAY['skill_id:uuid:!','group_id:uuid:!','scope:text:!','is_active:boolean:!','deleted_at:timestamp with time zone','version:uuid:!','created_at:timestamp with time zone:!','updated_at:timestamp with time zone:!']),
 ('ad_comp_course_configs',ARRAY['id:uuid:!','revision_id:uuid:!','course_code:text:!','status:text:!','version:uuid:!','note:text:!','created_at:timestamp with time zone:!','updated_at:timestamp with time zone:!']),
 ('ad_comp_course_links',ARRAY['config_id:uuid:!','skill_id:uuid:!','weight:numeric(12,10):!']),
 ('ad_comp_events',ARRAY['id:uuid:!','kind:text:!','entity_key:text:!','actor_id:uuid','snapshot:jsonb:!','note:text:!','created_at:timestamp with time zone:!']),
 ('ad_comp_import_aliases',ARRAY['cohort_code:text:!','source_name:text:!','skill_id:uuid:!']),
 ('ad_comp_imports',ARRAY['id:uuid:!','revision_id:uuid:!','filename:text:!','sha256:text:!','actor_id:uuid','summary:jsonb:!','created_at:timestamp with time zone:!'])
 ) AS shape(table_name,columns) LOOP
   relation_oid:=to_regclass(format('public.%I',expected.table_name));
   IF relation_oid IS NULL THEN CONTINUE; END IF;
   IF (SELECT relkind FROM pg_class WHERE oid=relation_oid)<>'r' THEN
     RAISE EXCEPTION 'AD-COMP table shape mismatch: % must be an ordinary table',expected.table_name;
   END IF;
   FOREACH specification IN ARRAY expected.columns LOOP
     attribute_name:=split_part(specification,':',1); attribute_type:=split_part(specification,':',2);
     IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=relation_oid AND attname=attribute_name AND NOT attisdropped
       AND format_type(atttypid,atttypmod)=attribute_type AND attnotnull=(split_part(specification,':',3)='!')) THEN
       RAISE EXCEPTION 'AD-COMP table shape mismatch: %.%',expected.table_name,attribute_name;
     END IF;
   END LOOP;
   IF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=relation_oid AND attnum>0 AND NOT attisdropped
     AND NOT EXISTS(SELECT 1 FROM unnest(expected.columns) value WHERE split_part(value,':',1)=attname)
     AND NOT(expected.table_name='ad_comp_skills' AND attname='legacy_skill_id' AND atttypid='uuid'::regtype AND NOT attnotnull)) THEN
     RAISE EXCEPTION 'AD-COMP table shape mismatch: unexpected column on %',expected.table_name;
   END IF;
 END LOOP;
END $$;

-- BEGIN AD-COMP TABLES
CREATE TABLE IF NOT EXISTS public.ad_comp_groups (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 160),
 description TEXT NOT NULL DEFAULT '' CHECK(length(description)<=2000),
 is_active BOOLEAN NOT NULL DEFAULT TRUE,
 version UUID NOT NULL DEFAULT gen_random_uuid(), source_key TEXT UNIQUE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ad_comp_groups_name ON public.ad_comp_groups(lower(name));
-- Preserve all three academic groups actually present in the supplied reference workbook.
INSERT INTO public.ad_comp_groups(name,source_key) VALUES
 ('Kiến thức nền tảng','Kiến thức nền tảng'),('Kỹ năng mềm','Kỹ năng mềm'),('Chuyên môn','Chuyên môn')
 ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.ad_comp_skills (
 skill_id UUID PRIMARY KEY REFERENCES public.career_skills(id),
 group_id UUID NOT NULL REFERENCES public.ad_comp_groups(id),
 scope TEXT NOT NULL DEFAULT '' CHECK(length(scope)<=4000),
 is_active BOOLEAN NOT NULL DEFAULT TRUE, deleted_at TIMESTAMPTZ,
 version UUID NOT NULL DEFAULT gen_random_uuid(),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ad_comp_skills_group ON public.ad_comp_skills(group_id);
CREATE TABLE IF NOT EXISTS public.ad_comp_course_configs (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), revision_id UUID NOT NULL, course_code TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','archived')),
 version UUID NOT NULL DEFAULT gen_random_uuid(), note TEXT NOT NULL DEFAULT '' CHECK(length(note)<=500),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(revision_id,course_code),
 FOREIGN KEY(revision_id,course_code) REFERENCES public.curriculum_courses(revision_id,code)
);
CREATE TABLE IF NOT EXISTS public.ad_comp_course_links (
 config_id UUID NOT NULL REFERENCES public.ad_comp_course_configs(id),
 skill_id UUID NOT NULL REFERENCES public.ad_comp_skills(skill_id),
 weight NUMERIC(12,10) NOT NULL CHECK(weight BETWEEN 0 AND 1),
 PRIMARY KEY(config_id,skill_id)
);
CREATE INDEX IF NOT EXISTS ad_comp_links_skill ON public.ad_comp_course_links(skill_id);
CREATE TABLE IF NOT EXISTS public.ad_comp_events (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 kind TEXT NOT NULL CHECK(kind IN ('group','skill','course','import','shared_skill')),
 entity_key TEXT NOT NULL, actor_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
 snapshot JSONB NOT NULL, note TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ad_comp_events_entity ON public.ad_comp_events(kind,entity_key,created_at DESC);
CREATE TABLE IF NOT EXISTS public.ad_comp_import_aliases (
 cohort_code TEXT NOT NULL CHECK(cohort_code ~ '^K[0-9]+$'),
 source_name TEXT NOT NULL CHECK(length(trim(source_name)) BETWEEN 1 AND 100),
 skill_id UUID NOT NULL REFERENCES public.ad_comp_skills(skill_id),
 PRIMARY KEY(cohort_code,source_name)
);
CREATE TABLE IF NOT EXISTS public.ad_comp_imports (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), revision_id UUID NOT NULL REFERENCES public.curriculum_revisions(id),
 filename TEXT NOT NULL CHECK(length(filename)<=240), sha256 TEXT NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),
 actor_id UUID REFERENCES public.users(id) ON DELETE SET NULL, summary JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ad_comp_imports_revision ON public.ad_comp_imports(revision_id,created_at DESC);

-- END AD-COMP TABLES

-- Validate keys and referenced relations in any pre-existing module tables.
DO $$ DECLARE expected RECORD; BEGIN
 FOR expected IN SELECT * FROM (VALUES
 ('ad_comp_groups','id'),('ad_comp_skills','skill_id'),('ad_comp_course_configs','id'),
 ('ad_comp_course_links','config_id,skill_id'),('ad_comp_events','id'),('ad_comp_import_aliases','cohort_code,source_name'),('ad_comp_imports','id')
 ) AS shape(table_name,columns) LOOP
   IF NOT EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid=to_regclass(format('public.%I',expected.table_name)) AND c.contype='p'
     AND (SELECT array_agg(a.attname::TEXT ORDER BY key.ordinality) FROM unnest(c.conkey) WITH ORDINALITY key(attnum,ordinality)
       JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=key.attnum)=string_to_array(expected.columns,',')) THEN
     RAISE EXCEPTION 'AD-COMP key shape mismatch: %',expected.table_name;
   END IF;
 END LOOP;
 FOR expected IN SELECT * FROM (VALUES
 ('ad_comp_skills','skill_id','career_skills','id'),('ad_comp_skills','group_id','ad_comp_groups','id'),
 ('ad_comp_course_configs','revision_id,course_code','curriculum_courses','revision_id,code'),
 ('ad_comp_course_links','config_id','ad_comp_course_configs','id'),('ad_comp_course_links','skill_id','ad_comp_skills','skill_id'),
 ('ad_comp_events','actor_id','users','id'),('ad_comp_import_aliases','skill_id','ad_comp_skills','skill_id'),
 ('ad_comp_imports','revision_id','curriculum_revisions','id'),('ad_comp_imports','actor_id','users','id')
 ) AS shape(table_name,columns,target_table,target_columns) LOOP
   IF NOT EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid=to_regclass(format('public.%I',expected.table_name)) AND c.contype='f' AND c.convalidated
     AND (c.confdeltype IN ('a','r') OR (expected.columns='actor_id' AND c.confdeltype='n'))
     AND c.confrelid=to_regclass(format('public.%I',expected.target_table))
     AND (SELECT array_agg(a.attname::TEXT ORDER BY key.ordinality) FROM unnest(c.conkey) WITH ORDINALITY key(attnum,ordinality)
       JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=key.attnum)=string_to_array(expected.columns,',')
     AND (SELECT array_agg(a.attname::TEXT ORDER BY key.ordinality) FROM unnest(c.confkey) WITH ORDINALITY key(attnum,ordinality)
       JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=key.attnum)=string_to_array(expected.target_columns,',')) THEN
     RAISE EXCEPTION 'AD-COMP reference shape mismatch: % -> %',expected.table_name,expected.target_table;
   END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid='public.ad_comp_course_configs'::regclass AND c.contype='u' AND c.convalidated
   AND (SELECT array_agg(a.attname::TEXT ORDER BY key.ordinality) FROM unnest(c.conkey) WITH ORDINALITY key(attnum,ordinality)
     JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=key.attnum)=ARRAY['revision_id','course_code']::TEXT[]) THEN
   RAISE EXCEPTION 'AD-COMP key shape mismatch: revision/course must be unique';
 END IF;
 FOR expected IN SELECT * FROM (VALUES
   ('ad_comp_course_links','weight>=0andweight<=1'),
   ('ad_comp_course_configs','status=anyarray[''draft'',''active'',''archived'']')
 ) AS shape(table_name,expression) LOOP
   IF NOT EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid=to_regclass(format('public.%I',expected.table_name))
     AND c.contype='c' AND c.convalidated AND NOT c.connoinherit
     AND lower(regexp_replace(regexp_replace(pg_get_expr(c.conbin,c.conrelid),'::(text|numeric)','','g'),'[[:space:]()]','','g'))=expected.expression) THEN
     RAISE EXCEPTION 'AD-COMP check shape mismatch: %',expected.table_name;
   END IF;
 END LOOP;
END $$;

ALTER TABLE public.ad_comp_skills ADD COLUMN IF NOT EXISTS legacy_skill_id UUID;
CREATE UNIQUE INDEX IF NOT EXISTS ad_comp_skills_legacy_identity ON public.ad_comp_skills(legacy_skill_id);
-- Connect to the prototype only when it is present. All prototype rows remain unchanged.
DO $$ BEGIN
 IF to_regclass('public.competency_skills') IS NOT NULL THEN
   IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.ad_comp_skills'::regclass AND conname='ad_comp_legacy_skill_fk') THEN
     ALTER TABLE public.ad_comp_skills ADD CONSTRAINT ad_comp_legacy_skill_fk
       FOREIGN KEY(legacy_skill_id) REFERENCES public.competency_skills(id);
   ELSIF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.ad_comp_skills'::regclass AND conname='ad_comp_legacy_skill_fk'
     AND contype='f' AND convalidated AND confdeltype IN ('a','r') AND confrelid='public.competency_skills'::regclass
     AND conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid='public.ad_comp_skills'::regclass AND attname='legacy_skill_id')]::SMALLINT[]
     AND confkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid='public.competency_skills'::regclass AND attname='id')]::SMALLINT[]) THEN
     RAISE EXCEPTION 'AD-COMP legacy bridge reference shape mismatch';
   END IF;
 END IF;
END $$;

-- Remove only module025 triggers on its own tables. On the shared career table,
-- require a helper body referencing new module data, or the exact catalog helper
-- also attached to a new module table. Never drop a trigger on competency_* tables.
DO $$ DECLARE attached RECORD; catalog_helpers OID[]; BEGIN
 SELECT array_agg(DISTINCT t.tgfoid) INTO catalog_helpers FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
   JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace pn ON pn.oid=p.pronamespace
   WHERE n.nspname='public' AND pn.nspname='public' AND c.relname IN ('ad_comp_groups','ad_comp_skills','ad_comp_course_configs','ad_comp_course_links')
   AND t.tgname='competency_catalog_lock' AND p.proname='competency_lock_catalog_trigger' AND p.prosrc LIKE '%1946032027%';
 FOR attached IN SELECT t.tgname,c.relname,p.proname,p.prosrc,t.tgfoid FROM pg_trigger t
   JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
   JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace pn ON pn.oid=p.pronamespace
   WHERE n.nspname='public' AND pn.nspname='public' AND NOT t.tgisinternal
   AND c.relname IN ('ad_comp_groups','ad_comp_skills','ad_comp_course_configs','ad_comp_course_links','career_skills')
   AND ((t.tgname IN ('competency_catalog_lock','competency_config_valid','competency_links_valid','competency_links_parent_lock',
     'competency_scope_immutable','competency_group_valid','competency_skill_valid','competency_shared_skill_protected','competency_shared_skill_changed')
     AND p.proname IN ('competency_lock_catalog_trigger','competency_check_config_trigger','competency_lock_link_parent',
       'competency_pin_scope','competency_check_group_trigger','competency_check_skill_trigger','competency_protect_shared_skill','competency_shared_skill_version'))
   OR (t.tgname IN ('ad_comp_catalog_lock','ad_comp_config_valid','ad_comp_links_valid','ad_comp_links_parent_lock',
     'ad_comp_scope_immutable','ad_comp_group_valid','ad_comp_skill_valid','ad_comp_shared_skill_protected','ad_comp_shared_skill_changed')
     AND p.proname LIKE 'ad_comp_%'))
 LOOP
   IF attached.relname<>'career_skills' OR attached.proname LIKE 'ad_comp_%' OR attached.prosrc LIKE '%ad_comp_skills%'
     OR (attached.tgname='competency_catalog_lock' AND attached.proname='competency_lock_catalog_trigger'
       AND attached.tgfoid=ANY(catalog_helpers)) THEN
     EXECUTE format('DROP TRIGGER %I ON public.%I',attached.tgname,attached.relname);
   END IF;
 END LOOP;
END $$;

-- Take the same catalog lock as the API before any row locks. Direct SQL at the
-- normal READ COMMITTED isolation level cannot race deactivation against activation.
-- BEGIN AD-COMP HELPERS
CREATE OR REPLACE FUNCTION public.ad_comp_lock_catalog_trigger() RETURNS TRIGGER
 LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(1946032027);
 RETURN NULL;
END $$;
DO $$ DECLARE t TEXT; BEGIN
 FOREACH t IN ARRAY ARRAY['ad_comp_groups','ad_comp_skills','ad_comp_course_configs','ad_comp_course_links','career_skills'] LOOP
   EXECUTE format('CREATE TRIGGER ad_comp_catalog_lock BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.ad_comp_lock_catalog_trigger()',t);
 END LOOP;
END $$;

-- Validate the final transaction state, allowing an atomic replacement of all allocations.
-- Explicit zero-weight links are retained but contribute nothing. Active totals must be 100%.
CREATE OR REPLACE FUNCTION public.ad_comp_assert_active_config(config_uuid UUID) RETURNS VOID
 LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE state TEXT; total NUMERIC; amount INTEGER;
BEGIN
 SELECT status INTO state FROM public.ad_comp_course_configs WHERE id=config_uuid;
 IF state IS DISTINCT FROM 'active' THEN RETURN; END IF;
 PERFORM s.skill_id FROM public.ad_comp_course_links l
   JOIN public.ad_comp_skills s ON s.skill_id=l.skill_id
   JOIN public.ad_comp_groups g ON g.id=s.group_id
   JOIN public.career_skills k ON k.id=s.skill_id
   WHERE l.config_id=config_uuid FOR SHARE OF s,g,k;
 SELECT COALESCE(sum(weight),0),count(*) INTO total,amount
 FROM public.ad_comp_course_links WHERE config_id=config_uuid;
 IF amount=0 OR abs(total-1)>0.000001 THEN
   RAISE EXCEPTION 'competency_weight_total' USING ERRCODE='23514',CONSTRAINT='competency_active_total';
 END IF;
 IF EXISTS(SELECT 1 FROM public.ad_comp_course_links l
   JOIN public.ad_comp_skills s ON s.skill_id=l.skill_id
   JOIN public.ad_comp_groups g ON g.id=s.group_id
   JOIN public.career_skills k ON k.id=s.skill_id
   WHERE l.config_id=config_uuid AND (NOT s.is_active OR s.deleted_at IS NOT NULL OR NOT g.is_active OR k.deleted_at IS NOT NULL)) THEN
   RAISE EXCEPTION 'competency_skill_unavailable' USING ERRCODE='23514',CONSTRAINT='competency_active_skills';
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.ad_comp_check_config_trigger() RETURNS TRIGGER
 LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_TABLE_NAME='ad_comp_course_configs' THEN
   PERFORM public.ad_comp_assert_active_config(NEW.id);
 ELSE
   IF TG_OP<>'INSERT' THEN PERFORM public.ad_comp_assert_active_config(OLD.config_id); END IF;
   IF TG_OP<>'DELETE' THEN PERFORM public.ad_comp_assert_active_config(NEW.config_id); END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER ad_comp_config_valid AFTER INSERT OR UPDATE ON public.ad_comp_course_configs
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.ad_comp_check_config_trigger();
CREATE CONSTRAINT TRIGGER ad_comp_links_valid AFTER INSERT OR UPDATE OR DELETE ON public.ad_comp_course_links
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.ad_comp_check_config_trigger();
-- Parent locks also serialize direct SQL writes, so deferred sums cannot suffer write skew.
CREATE OR REPLACE FUNCTION public.ad_comp_lock_link_parent() RETURNS TRIGGER
 LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN PERFORM id FROM public.ad_comp_course_configs WHERE id=OLD.config_id FOR UPDATE; END IF;
 IF TG_OP<>'DELETE' THEN PERFORM id FROM public.ad_comp_course_configs WHERE id=NEW.config_id FOR UPDATE; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ad_comp_links_parent_lock BEFORE INSERT OR UPDATE OR DELETE ON public.ad_comp_course_links
 FOR EACH ROW EXECUTE FUNCTION public.ad_comp_lock_link_parent();
CREATE OR REPLACE FUNCTION public.ad_comp_pin_scope() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.revision_id IS DISTINCT FROM OLD.revision_id OR NEW.course_code IS DISTINCT FROM OLD.course_code THEN
   RAISE EXCEPTION 'competency_scope_immutable' USING ERRCODE='23514',CONSTRAINT='competency_scope_immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ad_comp_scope_immutable BEFORE UPDATE ON public.ad_comp_course_configs
 FOR EACH ROW EXECUTE FUNCTION public.ad_comp_pin_scope();
-- Separate functions avoid referring to non-existent record fields in PL/pgSQL.
CREATE OR REPLACE FUNCTION public.ad_comp_check_group_trigger() RETURNS TRIGGER
 LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE config_uuid UUID;
BEGIN
 FOR config_uuid IN SELECT DISTINCT l.config_id FROM public.ad_comp_course_links l
 JOIN public.ad_comp_skills s ON s.skill_id=l.skill_id WHERE s.group_id=NEW.id LOOP
   PERFORM public.ad_comp_assert_active_config(config_uuid);
 END LOOP;
 RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION public.ad_comp_check_skill_trigger() RETURNS TRIGGER
 LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE config_uuid UUID;
BEGIN
 FOR config_uuid IN SELECT DISTINCT config_id FROM public.ad_comp_course_links WHERE skill_id=NEW.skill_id LOOP
   PERFORM public.ad_comp_assert_active_config(config_uuid);
 END LOOP;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER ad_comp_group_valid AFTER UPDATE ON public.ad_comp_groups
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.ad_comp_check_group_trigger();
CREATE CONSTRAINT TRIGGER ad_comp_skill_valid AFTER UPDATE ON public.ad_comp_skills
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.ad_comp_check_skill_trigger();
CREATE OR REPLACE FUNCTION public.ad_comp_protect_shared_skill() RETURNS TRIGGER
 LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL AND
 EXISTS(SELECT 1 FROM public.ad_comp_skills WHERE skill_id=NEW.id AND deleted_at IS NULL) THEN
   RAISE EXCEPTION 'competency_skill_in_use' USING ERRCODE='23514',CONSTRAINT='competency_shared_skill_in_use';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ad_comp_shared_skill_protected BEFORE UPDATE ON public.career_skills
 FOR EACH ROW EXECUTE FUNCTION public.ad_comp_protect_shared_skill();
CREATE OR REPLACE FUNCTION public.ad_comp_shared_skill_version() RETURNS TRIGGER
 LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.name IS DISTINCT FROM OLD.name OR NEW.description IS DISTINCT FROM OLD.description THEN
   UPDATE public.ad_comp_skills SET version=gen_random_uuid(),updated_at=now() WHERE skill_id=NEW.id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ad_comp_shared_skill_changed AFTER UPDATE ON public.career_skills
 FOR EACH ROW EXECUTE FUNCTION public.ad_comp_shared_skill_version();

-- END AD-COMP HELPERS

-- Any populated025 allocations must satisfy the same final-state invariants.
DO $$ DECLARE config_uuid UUID; BEGIN
 FOR config_uuid IN SELECT id FROM public.ad_comp_course_configs WHERE status='active' LOOP
   PERFORM public.ad_comp_assert_active_config(config_uuid);
 END LOOP;
END $$;

DO $$ DECLARE t TEXT; r TEXT; BEGIN
 FOREACH t IN ARRAY ARRAY['ad_comp_groups','ad_comp_skills','ad_comp_course_configs','ad_comp_course_links','ad_comp_events','ad_comp_import_aliases','ad_comp_imports'] LOOP
   EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
   EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',t);
   FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
     IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON public.%I FROM %I',t,r); END IF;
   END LOOP;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.ad_comp_assert_active_config(UUID) FROM PUBLIC;

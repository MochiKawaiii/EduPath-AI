-- Renumber existing fields and their career references together, including archived rows.
LOCK TABLE public.career_fields, public.career_positions IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE career_field_number_map ON COMMIT DROP AS
 SELECT id,code AS old_code,
 row_number() OVER (ORDER BY (deleted_at IS NOT NULL),name,id)::text AS new_code
 FROM public.career_fields;

ALTER TABLE public.career_positions DROP CONSTRAINT career_positions_category_fkey;
ALTER TABLE public.career_fields DROP CONSTRAINT career_fields_code_key;
UPDATE public.career_positions p SET category=m.new_code,version=gen_random_uuid(),updated_at=now()
 FROM career_field_number_map m WHERE p.category=m.old_code;
UPDATE public.career_fields f SET code=m.new_code,version=gen_random_uuid(),updated_at=now()
 FROM career_field_number_map m WHERE f.id=m.id;
ALTER TABLE public.career_fields DROP CONSTRAINT career_fields_code_check;
ALTER TABLE public.career_fields ADD CONSTRAINT career_fields_code_check CHECK(code ~ '^[1-9][0-9]*$');
ALTER TABLE public.career_fields ADD CONSTRAINT career_fields_code_key UNIQUE(code);
ALTER TABLE public.career_positions ADD CONSTRAINT career_positions_category_fkey
 FOREIGN KEY(category) REFERENCES public.career_fields(code) ON UPDATE CASCADE;

CREATE SEQUENCE public.career_field_code_seq AS BIGINT MINVALUE 1;
ALTER SEQUENCE public.career_field_code_seq OWNED BY public.career_fields.code;
SELECT setval('public.career_field_code_seq'::regclass,COALESCE(max(code::bigint),1),count(*)>0)
 FROM public.career_fields;

-- Ignore legacy manually supplied codes too, so old deployed clients can still add fields.
CREATE FUNCTION public.assign_career_field_number() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog AS $$
 BEGIN
  IF TG_OP='INSERT' THEN
   NEW.code:=nextval('public.career_field_code_seq'::regclass)::text;
  ELSE
   NEW.code:=OLD.code;
  END IF;
  RETURN NEW;
 END;
$$;
CREATE TRIGGER career_fields_assign_number BEFORE INSERT OR UPDATE OF code
 ON public.career_fields FOR EACH ROW EXECUTE FUNCTION public.assign_career_field_number();

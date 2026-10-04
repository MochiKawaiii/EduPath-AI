-- Change display codes only; UUID references from profiles and requirements stay intact.
LOCK TABLE public.career_positions IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE career_position_code_map ON COMMIT DROP AS
 SELECT id,code AS old_code,
 'NN' || lpad(number::text,greatest(3,length(number::text)),'0') AS new_code
 FROM (
  SELECT id,code,row_number() OVER (ORDER BY (deleted_at IS NOT NULL),name_vi,id) AS number
  FROM public.career_positions
 ) numbered;

ALTER TABLE public.career_positions DROP CONSTRAINT career_positions_code_key;
UPDATE public.career_positions p SET code=m.new_code,
 search_text=lower(m.new_code) || ' ' || CASE
  WHEN left(p.search_text,length(m.old_code)+1)=lower(m.old_code) || ' '
   THEN substr(p.search_text,length(m.old_code)+2)
  ELSE p.search_text END,
 version=gen_random_uuid(),updated_at=now()
 FROM career_position_code_map m WHERE p.id=m.id;
ALTER TABLE public.career_positions ADD CONSTRAINT career_positions_code_key UNIQUE(code);
ALTER TABLE public.career_positions ADD CONSTRAINT career_positions_code_check
 CHECK(code ~ '^NN[0-9]{3,}$' AND substr(code,3)::bigint>0);

CREATE SEQUENCE public.career_position_code_seq AS BIGINT MINVALUE 1;
ALTER SEQUENCE public.career_position_code_seq OWNED BY public.career_positions.code;
SELECT setval('public.career_position_code_seq'::regclass,
 COALESCE(max(substr(code,3)::bigint),1),count(*)>0) FROM public.career_positions;

-- Sequences allocate unique numbers concurrently; existing codes cannot be edited/reused.
-- Also override codes from older deployed clients during the rollout.
CREATE FUNCTION public.assign_career_position_code() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog AS $$
 DECLARE number text;
 BEGIN
  IF TG_OP='INSERT' THEN
   number:=nextval('public.career_position_code_seq'::regclass)::text;
   NEW.code:='NN' || lpad(number,greatest(3,length(number)),'0');
  ELSE
   NEW.code:=OLD.code;
  END IF;
  IF left(NEW.search_text,length(NEW.code)+1)<>lower(NEW.code) || ' ' THEN
   NEW.search_text:=lower(NEW.code) || ' ' || NEW.search_text;
  END IF;
  RETURN NEW;
 END;
$$;
CREATE TRIGGER career_positions_assign_code BEFORE INSERT OR UPDATE OF code
 ON public.career_positions FOR EACH ROW EXECUTE FUNCTION public.assign_career_position_code();

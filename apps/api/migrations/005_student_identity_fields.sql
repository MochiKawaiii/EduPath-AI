ALTER TABLE public.student_profiles
  ADD COLUMN full_name VARCHAR(200),
  ADD COLUMN cohort_code VARCHAR(8),
  ADD COLUMN class_name VARCHAR(32);

-- Preserve the original Microsoft display name on users. Only fill missing
-- profile fields from the complete, recognized student naming convention.
CREATE FUNCTION public.edupath_fill_student_identity(target_user_id UUID, raw_name TEXT)
RETURNS VOID LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  parts TEXT[];
  parsed_code TEXT;
  intake SMALLINT;
BEGIN
  parts := regexp_match(raw_name,
    '^[[:space:]]*([0-9]{8,32})[[:space:]]+[-–—][[:space:]]+(.+)[[:space:]]+[-–—][[:space:]]+[0-9]*[Kk]([0-9]{2})(([A-Za-z]+)[0-9]+)[[:space:]]*$');
  IF parts IS NULL OR btrim(parts[2]) = '' OR parts[3]::INTEGER < 27 THEN
    RETURN;
  END IF;
  intake := parts[3]::INTEGER + 1994;
  -- The student code is globally unique. Keep other parsed fields even if
  -- another Microsoft identity already owns this code; never merge identities.
  PERFORM pg_advisory_xact_lock(hashtext('edupath:student-identity'));
  parsed_code := parts[1];
  IF EXISTS (SELECT 1 FROM public.student_profiles
             WHERE student_code = parsed_code AND user_id <> target_user_id) THEN
    parsed_code := NULL;
  END IF;

  INSERT INTO public.student_profiles AS profile
    (user_id, student_code, full_name, cohort_code, class_name, cohort_year)
  VALUES (target_user_id, parsed_code, btrim(parts[2]), 'K' || parts[3], upper(parts[4]), intake)
  ON CONFLICT (user_id) DO UPDATE SET
    student_code = COALESCE(profile.student_code, EXCLUDED.student_code),
    full_name = COALESCE(profile.full_name, EXCLUDED.full_name),
    cohort_code = COALESCE(profile.cohort_code, EXCLUDED.cohort_code),
    class_name = COALESCE(profile.class_name, EXCLUDED.class_name),
    cohort_year = COALESCE(profile.cohort_year, EXCLUDED.cohort_year),
    updated_at = CURRENT_TIMESTAMP
  WHERE profile.student_code IS NULL OR profile.full_name IS NULL
     OR profile.cohort_code IS NULL OR profile.class_name IS NULL OR profile.cohort_year IS NULL;
END;
$$;

CREATE FUNCTION public.edupath_student_identity_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM public.edupath_fill_student_identity(NEW.id, NEW.display_name);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.edupath_fill_student_identity(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.edupath_student_identity_trigger() FROM PUBLIC;

CREATE TRIGGER users_fill_student_identity
AFTER INSERT OR UPDATE OF display_name ON public.users
FOR EACH ROW EXECUTE FUNCTION public.edupath_student_identity_trigger();

-- Existing users receive the same extraction without signing in again.
DO $$
DECLARE account RECORD;
BEGIN
  FOR account IN SELECT id, display_name FROM public.users ORDER BY created_at, id LOOP
    PERFORM public.edupath_fill_student_identity(account.id, account.display_name);
  END LOOP;
END;
$$;

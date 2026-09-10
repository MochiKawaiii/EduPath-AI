-- Supabase can assign default function privileges to its Data API roles.
DO $$
DECLARE api_role TEXT;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.edupath_fill_student_identity(UUID, TEXT) FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON FUNCTION public.edupath_student_identity_trigger() FROM %I', api_role);
    END IF;
  END LOOP;
END;
$$;


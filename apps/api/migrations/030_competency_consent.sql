-- Consent purpose for the competency assessment and its AI comments (policy 2026-10-11).
-- 018 created an unnamed CHECK on purpose; drop every CHECK that covers only the purpose
-- column, whatever name PostgreSQL generated for it, then add a named one.
DO $$ DECLARE c RECORD; BEGIN
  FOR c IN SELECT con.conname FROM pg_constraint con
    WHERE con.conrelid='public.data_consents'::regclass AND con.contype='c'
      AND con.conkey=ARRAY[(SELECT a.attnum FROM pg_attribute a
        WHERE a.attrelid='public.data_consents'::regclass AND a.attname='purpose' AND NOT a.attisdropped)]::int2[]
  LOOP
    EXECUTE format('ALTER TABLE public.data_consents DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE public.data_consents ADD CONSTRAINT data_consents_purpose_allowed
  CHECK (purpose IN ('transcript_processing','competency_assessment'));

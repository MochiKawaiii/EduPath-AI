-- Student specialty (chuyên ngành). NULL means "Chưa xác định". It selects the graduation
-- standard and the specialty courses used by the competency assessment.
ALTER TABLE public.student_profiles ADD COLUMN specialty TEXT
  CONSTRAINT student_profiles_specialty_check CHECK (specialty IN ('CNPM','CNDL','TTNT'));

CREATE TABLE public.career_fields (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 code TEXT NOT NULL UNIQUE CHECK(code ~ '^[a-z0-9]+([-_][a-z0-9]+)*$'),
 name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 160),
 description TEXT NOT NULL DEFAULT '',
 version UUID NOT NULL DEFAULT gen_random_uuid(), deleted_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX career_fields_names ON public.career_fields(lower(name)) WHERE deleted_at IS NULL;
INSERT INTO public.career_fields(code,name) VALUES
 ('software','Phát triển phần mềm'),
 ('data_ai','Dữ liệu & Trí tuệ nhân tạo'),
 ('security','An toàn thông tin'),
 ('infrastructure','Hạ tầng & Điện toán đám mây'),
 ('quality','Kiểm thử & Chất lượng'),
 ('product','Nghiệp vụ & Thiết kế');
ALTER TABLE public.career_positions DROP CONSTRAINT career_positions_category_check;
ALTER TABLE public.career_positions ADD CONSTRAINT career_positions_category_fkey
 FOREIGN KEY(category) REFERENCES public.career_fields(code);
CREATE INDEX career_positions_category ON public.career_positions(category) WHERE deleted_at IS NULL;
ALTER TABLE public.career_fields ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.career_fields FROM PUBLIC;
DO $$ DECLARE role_name TEXT; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON public.career_fields FROM %I',role_name);
  END IF;
 END LOOP;
END $$;

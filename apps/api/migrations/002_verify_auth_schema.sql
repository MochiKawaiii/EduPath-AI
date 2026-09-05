DO $$
BEGIN
  IF to_regclass('public.users') IS NULL THEN
    RAISE EXCEPTION 'Required table public.users is missing';
  END IF;

  IF to_regclass('public.student_profiles') IS NULL THEN
    RAISE EXCEPTION 'Required table public.student_profiles is missing';
  END IF;

  IF to_regclass('public.user_sessions') IS NULL THEN
    RAISE EXCEPTION 'Required table public.user_sessions is missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      VALUES
        ('id'),
        ('entra_tenant_id'),
        ('entra_object_id'),
        ('entra_subject'),
        ('display_name'),
        ('role'),
        ('is_active'),
        ('first_login_at'),
        ('last_login_at')
    ) AS required(column_name)
    WHERE NOT EXISTS (
      SELECT 1
      FROM information_schema.columns AS actual
      WHERE actual.table_schema = 'public'
        AND actual.table_name = 'users'
        AND actual.column_name = required.column_name
    )
  ) THEN
    RAISE EXCEPTION 'Table public.users is missing one or more required columns';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES ('sid'), ('sess'), ('expire')) AS required(column_name)
    WHERE NOT EXISTS (
      SELECT 1
      FROM information_schema.columns AS actual
      WHERE actual.table_schema = 'public'
        AND actual.table_name = 'user_sessions'
        AND actual.column_name = required.column_name
    )
  ) THEN
    RAISE EXCEPTION 'Table public.user_sessions is missing one or more required columns';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.users'::regclass
      AND conname = 'users_entra_identity_unique'
      AND contype = 'u'
  ) THEN
    RAISE EXCEPTION 'Required unique identity constraint is missing from public.users';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.users'::regclass
      AND conname = 'users_role_check'
      AND contype = 'c'
  ) THEN
    RAISE EXCEPTION 'Required role constraint is missing from public.users';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.student_profiles'::regclass
      AND contype = 'f'
      AND confrelid = 'public.users'::regclass
  ) THEN
    RAISE EXCEPTION 'Required user foreign key is missing from public.student_profiles';
  END IF;
END
$$;

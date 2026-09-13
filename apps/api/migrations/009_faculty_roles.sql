ALTER TABLE public.users DROP CONSTRAINT users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check
  CHECK (role IN ('student', 'admin', 'faculty_board', 'department_head', 'lecturer'));
ALTER TABLE public.users DROP CONSTRAINT users_role_override_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_override_check
  CHECK (role_override IN ('student', 'admin', 'faculty_board', 'department_head', 'lecturer'));

-- Preserve student membership when granting a separate administrative role.
ALTER TABLE public.users ADD COLUMN is_student BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE public.users u SET is_student = TRUE
WHERE COALESCE(u.role_override, u.role) = 'student'
  OR EXISTS (SELECT 1 FROM public.student_profiles p WHERE p.user_id = u.id AND p.student_code IS NOT NULL);

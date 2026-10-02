BEGIN;
CREATE TEMP TABLE demo_seed (n int, name text, role text, email text, student_code text, cohort text, year int, class_name text, semester int, career_code text, interests text) ON COMMIT DROP;
CREATE TEMP TABLE demo_users_before ON COMMIT DROP AS
SELECT id, md5(row_to_json(u)::text) AS fingerprint FROM public.users u;
CREATE TEMP TABLE demo_profiles_before ON COMMIT DROP AS
SELECT user_id, md5(row_to_json(p)::text) AS fingerprint FROM public.student_profiles p;
INSERT INTO demo_seed VALUES
(1,'Nguyễn Minh Khôi','student','khoi.2174802010501@vanlanguni.vn','2174802010501','K27',2021,'CNTT01',1,'software','Lập trình ứng dụng, đọc sách công nghệ'),
(2,'Trần Ngọc Anh','student','anh.2274802010501@vanlanguni.vn','2274802010501','K28',2022,'CNTT02',1,'backend','Thiết kế hệ thống, giải thuật'),
(3,'Lê Hoàng Phúc','student','phuc.2374802010501@vanlanguni.vn','2374802010501','K29',2023,'CNTT03',1,'frontend','Thiết kế giao diện, nhiếp ảnh'),
(4,'Phạm Thảo Vy','student','vy.2474802010501@vanlanguni.vn','2474802010501','K30',2024,'CNTT04',1,'data-analyst','Phân tích dữ liệu, thống kê'),
(5,'Võ Gia Huy','student','huy.2574802010501@vanlanguni.vn','2574802010501','K31',2025,'CNTT05',1,'ai-engineer','Trí tuệ nhân tạo, nghiên cứu'),
(6,'Đặng Hải Yến','student','yen.2674802010501@vanlanguni.vn','2674802010501','K32',2026,'CNTT06',1,'mobile','Ứng dụng di động, thể thao'),
(7,'Bùi Đức Minh','student','minh.2174802010502@vanlanguni.vn','2174802010502','K27',2021,'CNTT07',1,'qa','Kiểm thử phần mềm, làm việc nhóm'),
(8,'Đỗ Khánh Linh','student','linh.2274802010502@vanlanguni.vn','2274802010502','K28',2022,'CNTT08',1,'cloud','Điện toán đám mây, Linux'),
(9,'Huỳnh Quốc Bảo','student','bao.2374802010502@vanlanguni.vn','2374802010502','K29',2023,'CNTT01',1,'security-analyst','An toàn thông tin, mạng máy tính'),
(10,'Nguyễn Hà My','student','my.2474802010502@vanlanguni.vn','2474802010502','K30',2024,'CNTT02',1,'software','Lập trình ứng dụng, đọc sách công nghệ'),
(11,'Trần Tuấn Kiệt','student','kiet.2574802010502@vanlanguni.vn','2574802010502','K31',2025,'CNTT03',1,'backend','Thiết kế hệ thống, giải thuật'),
(12,'Lê Phương Nhi','student','nhi.2674802010502@vanlanguni.vn','2674802010502','K32',2026,'CNTT04',1,'frontend','Thiết kế giao diện, nhiếp ảnh'),
(13,'Phạm Nhật Nam','student','nam.2174802010503@vanlanguni.vn','2174802010503','K27',2021,'CNTT05',1,'data-analyst','Phân tích dữ liệu, thống kê'),
(14,'Võ Quỳnh Chi','student','chi.2274802010503@vanlanguni.vn','2274802010503','K28',2022,'CNTT06',1,'ai-engineer','Trí tuệ nhân tạo, nghiên cứu'),
(15,'Đặng Anh Khoa','student','khoa.2374802010503@vanlanguni.vn','2374802010503','K29',2023,'CNTT07',1,'mobile','Ứng dụng di động, thể thao'),
(16,'Bùi Thanh Trúc','student','truc.2474802010503@vanlanguni.vn','2474802010503','K30',2024,'CNTT08',1,'qa','Kiểm thử phần mềm, làm việc nhóm'),
(17,'Đỗ Minh Quân','student','quan.2574802010503@vanlanguni.vn','2574802010503','K31',2025,'CNTT01',1,'cloud','Điện toán đám mây, Linux'),
(18,'Huỳnh Bảo Ngọc','student','ngoc.2674802010503@vanlanguni.vn','2674802010503','K32',2026,'CNTT02',1,'security-analyst','An toàn thông tin, mạng máy tính'),
(19,'Nguyễn Thiên Long','student','long.2174802010504@vanlanguni.vn','2174802010504','K27',2021,'CNTT03',1,'software','Lập trình ứng dụng, đọc sách công nghệ'),
(20,'Trần Kim Ngân','student','ngan.2274802010504@vanlanguni.vn','2274802010504','K28',2022,'CNTT04',1,'backend','Thiết kế hệ thống, giải thuật'),
(21,'Lê Thành Đạt','student','dat.2374802010504@vanlanguni.vn','2374802010504','K29',2023,'CNTT05',1,'frontend','Thiết kế giao diện, nhiếp ảnh'),
(22,'Phạm Mai Hương','student','huong.2474802010504@vanlanguni.vn','2474802010504','K30',2024,'CNTT06',1,'data-analyst','Phân tích dữ liệu, thống kê'),
(23,'Võ Tấn Lộc','student','loc.2574802010504@vanlanguni.vn','2574802010504','K31',2025,'CNTT07',1,'ai-engineer','Trí tuệ nhân tạo, nghiên cứu'),
(24,'Đặng Diệu Linh','student','linh.2674802010504@vanlanguni.vn','2674802010504','K32',2026,'CNTT08',1,'mobile','Ứng dụng di động, thể thao'),
(25,'Bùi Gia Bảo','student','bao.2174802010505@vanlanguni.vn','2174802010505','K27',2021,'CNTT01',1,'qa','Kiểm thử phần mềm, làm việc nhóm'),
(26,'Đỗ Ngọc Hân','student','han.2274802010505@vanlanguni.vn','2274802010505','K28',2022,'CNTT02',1,'cloud','Điện toán đám mây, Linux'),
(27,'Huỳnh Duy Khang','student','khang.2374802010505@vanlanguni.vn','2374802010505','K29',2023,'CNTT03',1,'security-analyst','An toàn thông tin, mạng máy tính'),
(28,'Nguyễn Hồng Nhung','student','nhung.2474802010505@vanlanguni.vn','2474802010505','K30',2024,'CNTT04',1,'software','Lập trình ứng dụng, đọc sách công nghệ'),
(29,'Trần Đức Anh','student','anh.2574802010505@vanlanguni.vn','2574802010505','K31',2025,'CNTT05',1,'backend','Thiết kế hệ thống, giải thuật'),
(30,'Lê Minh Châu','student','chau.2674802010505@vanlanguni.vn','2674802010505','K32',2026,'CNTT06',1,'frontend','Thiết kế giao diện, nhiếp ảnh'),
(31,'Phạm Quang Huy','student','huy.2174802010506@vanlanguni.vn','2174802010506','K27',2021,'CNTT07',1,'data-analyst','Phân tích dữ liệu, thống kê'),
(32,'Võ Yến Nhi','student','nhi.2274802010506@vanlanguni.vn','2274802010506','K28',2022,'CNTT08',1,'ai-engineer','Trí tuệ nhân tạo, nghiên cứu'),
(33,'Đặng Trung Hiếu','student','hieu.2374802010506@vanlanguni.vn','2374802010506','K29',2023,'CNTT01',1,'mobile','Ứng dụng di động, thể thao'),
(34,'Bùi Thùy Dương','student','duong.2474802010506@vanlanguni.vn','2474802010506','K30',2024,'CNTT02',1,'qa','Kiểm thử phần mềm, làm việc nhóm'),
(35,'Đỗ Hoài Nam','student','nam.2574802010506@vanlanguni.vn','2574802010506','K31',2025,'CNTT03',1,'cloud','Điện toán đám mây, Linux'),
(36,'Huỳnh Mỹ Duyên','student','duyen.2674802010506@vanlanguni.vn','2674802010506','K32',2026,'CNTT04',1,'security-analyst','An toàn thông tin, mạng máy tính'),
(37,'Nguyễn Anh Tuấn','student','tuan.2174802010507@vanlanguni.vn','2174802010507','K27',2021,'CNTT05',1,'software','Lập trình ứng dụng, đọc sách công nghệ'),
(38,'Trần Khánh Vy','student','vy.2274802010507@vanlanguni.vn','2274802010507','K28',2022,'CNTT06',1,'backend','Thiết kế hệ thống, giải thuật'),
(39,'Lê Bảo Long','student','long.2374802010507@vanlanguni.vn','2374802010507','K29',2023,'CNTT07',1,'frontend','Thiết kế giao diện, nhiếp ảnh'),
(40,'Phạm Ngọc Trâm','student','tram.2474802010507@vanlanguni.vn','2474802010507','K30',2024,'CNTT08',1,'data-analyst','Phân tích dữ liệu, thống kê'),
(41,'Võ Thanh Sơn','student','son.2574802010507@vanlanguni.vn','2574802010507','K31',2025,'CNTT01',1,'ai-engineer','Trí tuệ nhân tạo, nghiên cứu'),
(42,'Đặng Hải Hà','student','ha.2674802010507@vanlanguni.vn','2674802010507','K32',2026,'CNTT02',1,'mobile','Ứng dụng di động, thể thao'),
(43,'Bùi Quốc Hưng','student','hung.2174802010508@vanlanguni.vn','2174802010508','K27',2021,'CNTT03',1,'qa','Kiểm thử phần mềm, làm việc nhóm'),
(44,'Đỗ Phương Thảo','student','thao.2274802010508@vanlanguni.vn','2274802010508','K28',2022,'CNTT04',1,'cloud','Điện toán đám mây, Linux'),
(45,'Huỳnh Minh Triết','student','triet.2374802010508@vanlanguni.vn','2374802010508','K29',2023,'CNTT05',1,'security-analyst','An toàn thông tin, mạng máy tính'),
(46,'Nguyễn Hữu Thành','admin','nguyenhuuthanh@vlu.edu.vn',NULL,NULL,NULL,NULL,NULL,NULL,NULL),
(47,'Trần Thu Hằng','faculty_board','tranthuhang@vlu.edu.vn',NULL,NULL,NULL,NULL,NULL,NULL,NULL),
(48,'Lê Quang Vinh','department_head','lequangvinh@vlu.edu.vn',NULL,NULL,NULL,NULL,NULL,NULL,NULL),
(49,'Phạm Minh Tâm','lecturer','phamminhtam@vlu.edu.vn',NULL,NULL,NULL,NULL,NULL,NULL,NULL),
(50,'Võ Ngọc Lan','lecturer','vongoclan@vlu.edu.vn',NULL,NULL,NULL,NULL,NULL,NULL,NULL);
ALTER TABLE demo_seed ADD COLUMN id uuid;
UPDATE demo_seed SET id=md5('edupath-demo-2026-10-02:'||n)::uuid;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.users) THEN RAISE EXCEPTION 'Cannot infer Entra tenant from existing accounts'; END IF;
 IF EXISTS(SELECT 1 FROM demo_seed s JOIN public.users u ON lower(u.email)=lower(s.email) WHERE u.id<>s.id) OR
    EXISTS(SELECT 1 FROM demo_seed s JOIN public.student_profiles p USING(student_code) WHERE p.user_id<>s.id) THEN
   RAISE EXCEPTION 'Existing email or student code collision; no records written';
 END IF;
 IF EXISTS(SELECT 1 FROM demo_seed s JOIN public.users u USING(id) WHERE u.entra_subject<>'edupath-demo-2026-10-02:'||s.n OR u.email<>s.email OR u.display_name<>s.name OR u.role<>s.role) THEN
   RAISE EXCEPTION 'Existing seed identity differs; refusing to overwrite';
 END IF;
 IF EXISTS(SELECT 1 FROM demo_seed s WHERE s.role='student' AND NOT EXISTS(SELECT 1 FROM public.career_positions c WHERE c.code=s.career_code AND c.deleted_at IS NULL)) THEN
   RAISE EXCEPTION 'A selected career is missing';
 END IF;
END $$;
INSERT INTO public.users(id,entra_tenant_id,entra_object_id,entra_subject,display_name,email,username,role,role_override,is_student,is_active,first_login_at,last_login_at)
SELECT s.id,(SELECT entra_tenant_id FROM public.users GROUP BY entra_tenant_id ORDER BY count(*) DESC,entra_tenant_id LIMIT 1),
 md5('edupath-demo-2026-10-02:object:'||s.n)::uuid,'edupath-demo-2026-10-02:'||s.n,s.name,s.email,s.email,s.role,
 CASE WHEN s.role='student' THEN NULL ELSE s.role END,s.role='student',true,now(),now()
FROM demo_seed s WHERE NOT EXISTS(SELECT 1 FROM public.users u WHERE u.id=s.id);
INSERT INTO public.student_profiles(user_id,student_code,cohort_year,current_semester,career_goal,onboarding_completed,full_name,cohort_code,class_name,interests,career_position_id)
SELECT s.id,s.student_code,s.year,s.semester,c.name_vi,false,s.name,s.cohort,s.class_name,s.interests,c.id
FROM demo_seed s JOIN public.career_positions c ON c.code=s.career_code AND c.deleted_at IS NULL
WHERE s.role='student' AND NOT EXISTS(SELECT 1 FROM public.student_profiles p WHERE p.user_id=s.id);
DO $$ BEGIN
 IF (SELECT count(*) FROM public.users WHERE entra_subject LIKE 'edupath-demo-2026-10-02:%')<>50 OR
    (SELECT count(*) FROM public.student_profiles p JOIN demo_seed s ON s.id=p.user_id WHERE s.role='student' AND p.student_code=s.student_code AND p.cohort_code=s.cohort AND p.full_name=s.name AND p.career_position_id IS NOT NULL)<>45 THEN
   RAISE EXCEPTION 'Seed verification failed';
 END IF;
END $$;
DO $$ BEGIN
 IF EXISTS(
   SELECT 1 FROM demo_users_before old
   LEFT JOIN public.users current ON current.id=old.id
   WHERE current.id IS NULL OR old.fingerprint<>md5(row_to_json(current)::text)
 ) OR EXISTS(
   SELECT 1 FROM demo_profiles_before old
   LEFT JOIN public.student_profiles current ON current.user_id=old.user_id
   WHERE current.user_id IS NULL OR old.fingerprint<>md5(row_to_json(current)::text)
 ) THEN
   RAISE EXCEPTION 'Existing users or student profiles changed; refusing to commit';
 END IF;
END $$;
COMMIT;
SELECT role,count(*) AS added_accounts FROM public.users WHERE entra_subject LIKE 'edupath-demo-2026-10-02:%' GROUP BY role ORDER BY role;
SELECT cohort_code,count(*) AS added_students FROM public.student_profiles p JOIN public.users u ON u.id=p.user_id WHERE u.entra_subject LIKE 'edupath-demo-2026-10-02:%' GROUP BY cohort_code ORDER BY cohort_code;

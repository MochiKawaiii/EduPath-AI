// Synthetic application records only. Does not provision Microsoft sign-in accounts.
// Usage: node scripts/seed-demo-accounts.mjs --export
//        node scripts/seed-demo-accounts.mjs --apply-local
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import dotenv from 'dotenv';
import pg from 'pg';

export const batch = 'edupath-demo-2026-10-02';
const names = [
  'Nguyễn Minh Khôi', 'Trần Ngọc Anh', 'Lê Hoàng Phúc', 'Phạm Thảo Vy',
  'Võ Gia Huy', 'Đặng Hải Yến', 'Bùi Đức Minh', 'Đỗ Khánh Linh',
  'Huỳnh Quốc Bảo', 'Nguyễn Hà My', 'Trần Tuấn Kiệt', 'Lê Phương Nhi',
  'Phạm Nhật Nam', 'Võ Quỳnh Chi', 'Đặng Anh Khoa', 'Bùi Thanh Trúc',
  'Đỗ Minh Quân', 'Huỳnh Bảo Ngọc', 'Nguyễn Thiên Long', 'Trần Kim Ngân',
  'Lê Thành Đạt', 'Phạm Mai Hương', 'Võ Tấn Lộc', 'Đặng Diệu Linh',
  'Bùi Gia Bảo', 'Đỗ Ngọc Hân', 'Huỳnh Duy Khang', 'Nguyễn Hồng Nhung',
  'Trần Đức Anh', 'Lê Minh Châu', 'Phạm Quang Huy', 'Võ Yến Nhi',
  'Đặng Trung Hiếu', 'Bùi Thùy Dương', 'Đỗ Hoài Nam', 'Huỳnh Mỹ Duyên',
  'Nguyễn Anh Tuấn', 'Trần Khánh Vy', 'Lê Bảo Long', 'Phạm Ngọc Trâm',
  'Võ Thanh Sơn', 'Đặng Hải Hà', 'Bùi Quốc Hưng', 'Đỗ Phương Thảo',
  'Huỳnh Minh Triết',
];
const careers = ['software', 'backend', 'frontend', 'data-analyst', 'ai-engineer', 'mobile', 'qa', 'cloud', 'security-analyst'];
const interests = ['Lập trình ứng dụng, đọc sách công nghệ', 'Thiết kế hệ thống, giải thuật', 'Thiết kế giao diện, nhiếp ảnh', 'Phân tích dữ liệu, thống kê', 'Trí tuệ nhân tạo, nghiên cứu', 'Ứng dụng di động, thể thao', 'Kiểm thử phần mềm, làm việc nhóm', 'Điện toán đám mây, Linux', 'An toàn thông tin, mạng máy tính'];
const ascii = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
export const records = names.map((name, i) => {
  const cohort = 27 + i % 6;
  const studentCode = `${cohort - 6}74802010${String(501 + Math.floor(i / 6)).padStart(3, '0')}`;
  return { index: i + 1, name, role: 'student', email: `${ascii(name.split(' ').at(-1))}.${studentCode}@vanlanguni.vn`, studentCode,
    cohort: `K${cohort}`, year: cohort + 1994, className: `CNTT${String(1 + i % 8).padStart(2, '0')}`,
    semester: 1, careerCode: careers[i % careers.length], interests: interests[i % interests.length] };
});
[
  ['Nguyễn Hữu Thành', 'admin'], ['Trần Thu Hằng', 'faculty_board'],
  ['Lê Quang Vinh', 'department_head'], ['Phạm Minh Tâm', 'lecturer'], ['Võ Ngọc Lan', 'lecturer'],
].forEach(([name, role], i) => records.push({ index: 46 + i, name, role,
  email: `${ascii(name).replaceAll(' ', '')}@vlu.edu.vn`, studentCode: null, cohort: null,
  year: null, className: null, semester: null, careerCode: null, interests: null }));
const q = v => v === null ? 'NULL' : typeof v === 'number' ? String(v) : `'${v.replaceAll("'", "''")}'`;
export const sql = `BEGIN;
CREATE TEMP TABLE demo_seed (n int, name text, role text, email text, student_code text, cohort text, year int, class_name text, semester int, career_code text, interests text) ON COMMIT DROP;
CREATE TEMP TABLE demo_users_before ON COMMIT DROP AS
SELECT id, md5(row_to_json(u)::text) AS fingerprint FROM public.users u;
CREATE TEMP TABLE demo_profiles_before ON COMMIT DROP AS
SELECT user_id, md5(row_to_json(p)::text) AS fingerprint FROM public.student_profiles p;
INSERT INTO demo_seed VALUES
${records.map(r => `(${Object.values(r).map(q).join(',')})`).join(',\n')};
ALTER TABLE demo_seed ADD COLUMN id uuid;
UPDATE demo_seed SET id=md5('${batch}:'||n)::uuid;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.users) THEN RAISE EXCEPTION 'Cannot infer Entra tenant from existing accounts'; END IF;
 IF EXISTS(SELECT 1 FROM demo_seed s JOIN public.users u ON lower(u.email)=lower(s.email) WHERE u.id<>s.id) OR
    EXISTS(SELECT 1 FROM demo_seed s JOIN public.student_profiles p USING(student_code) WHERE p.user_id<>s.id) THEN
   RAISE EXCEPTION 'Existing email or student code collision; no records written';
 END IF;
 IF EXISTS(SELECT 1 FROM demo_seed s JOIN public.users u USING(id) WHERE u.entra_subject<>'${batch}:'||s.n OR u.email<>s.email OR u.display_name<>s.name OR u.role<>s.role) THEN
   RAISE EXCEPTION 'Existing seed identity differs; refusing to overwrite';
 END IF;
 IF EXISTS(SELECT 1 FROM demo_seed s WHERE s.role='student' AND NOT EXISTS(SELECT 1 FROM public.career_positions c WHERE c.code=s.career_code AND c.deleted_at IS NULL)) THEN
   RAISE EXCEPTION 'A selected career is missing';
 END IF;
END $$;
INSERT INTO public.users(id,entra_tenant_id,entra_object_id,entra_subject,display_name,email,username,role,role_override,is_student,is_active,first_login_at,last_login_at)
SELECT s.id,(SELECT entra_tenant_id FROM public.users GROUP BY entra_tenant_id ORDER BY count(*) DESC,entra_tenant_id LIMIT 1),
 md5('${batch}:object:'||s.n)::uuid,'${batch}:'||s.n,s.name,s.email,s.email,s.role,
 CASE WHEN s.role='student' THEN NULL ELSE s.role END,s.role='student',true,now(),now()
FROM demo_seed s WHERE NOT EXISTS(SELECT 1 FROM public.users u WHERE u.id=s.id);
INSERT INTO public.student_profiles(user_id,student_code,cohort_year,current_semester,career_goal,onboarding_completed,full_name,cohort_code,class_name,interests,career_position_id)
SELECT s.id,s.student_code,s.year,s.semester,c.name_vi,false,s.name,s.cohort,s.class_name,s.interests,c.id
FROM demo_seed s JOIN public.career_positions c ON c.code=s.career_code AND c.deleted_at IS NULL
WHERE s.role='student' AND NOT EXISTS(SELECT 1 FROM public.student_profiles p WHERE p.user_id=s.id);
DO $$ BEGIN
 IF (SELECT count(*) FROM public.users WHERE entra_subject LIKE '${batch}:%')<>50 OR
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
SELECT role,count(*) AS added_accounts FROM public.users WHERE entra_subject LIKE '${batch}:%' GROUP BY role ORDER BY role;
SELECT cohort_code,count(*) AS added_students FROM public.student_profiles p JOIN public.users u ON u.id=p.user_id WHERE u.entra_subject LIKE '${batch}:%' GROUP BY cohort_code ORDER BY cohort_code;
`;

if (process.argv.includes('--export')) {
  await mkdir('output/demo-accounts', { recursive: true });
  await writeFile('output/demo-accounts/seed.sql', sql, 'utf8');
  await writeFile('output/demo-accounts/roster.json', JSON.stringify({ batch, synthetic: true, records }, null, 2), 'utf8');
  await writeFile('output/demo-accounts/roster.csv', '\ufeff' + [Object.keys(records[0]).join(','), ...records.map(r => Object.values(r).map(v => `"${String(v ?? '').replaceAll('"', '""')}"`).join(','))].join('\r\n'), 'utf8');
  console.log('Exported 45 synthetic students and 5 faculty/admin records to output/demo-accounts.');
}
if (process.argv.includes('--apply-local')) {
  const env = dotenv.parse(await readFile('apps/api/.env', 'utf8'));
  if (!['localhost', '127.0.0.1'].includes(new URL(env.DATABASE_URL).hostname)) throw new Error('Local database required');
  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  try {
    const before = await client.query('SELECT id,md5(row_to_json(u)::text) fingerprint FROM public.users u');
    const results = await client.query(sql);
    const after = await client.query('SELECT id,md5(row_to_json(u)::text) fingerprint FROM public.users u');
    if (before.rows.some(b => after.rows.find(a => a.id === b.id)?.fingerprint !== b.fingerprint)) throw new Error('Existing record changed');
    console.log(JSON.stringify({ before: before.rowCount, after: after.rowCount, seed: results.filter(r => r.command === 'SELECT').map(r => r.rows) }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', error.code ?? error.message);
    process.exitCode = 1;
  } finally { await client.end(); }
}

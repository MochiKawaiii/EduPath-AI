# Hồ sơ mẫu EduPath

Bộ dữ liệu `edupath-demo-2026-10-02` gồm 45 sinh viên và 5 cán bộ với tên Việt Nam giả lập. Đây là bản ghi ứng dụng, không tạo tài khoản Microsoft hoặc thông tin đăng nhập thật.

| Khóa | Số sinh viên | Tiền tố MSSV |
| --- | ---: | --- |
| K27 | 8 | 2174802010 |
| K28 | 8 | 2274802010 |
| K29 | 8 | 2374802010 |
| K30 | 7 | 2474802010 |
| K31 | 7 | 2574802010 |
| K32 | 7 | 2674802010 |

Ba số cuối MSSV nằm trong khoảng 501–508. Email sinh viên dùng `ten.mssv@vanlanguni.vn`. Năm nhập học, lớp, học kỳ, sở thích và mục tiêu nghề nghiệp được điền; không tạo bảng điểm giả. Cán bộ gồm 1 quản trị viên, 1 Ban chủ nhiệm khoa, 1 Trưởng/phó bộ môn và 2 giảng viên, dùng email mẫu `@vlu.edu.vn`.

`roster.csv` và `roster.json` chứa danh sách đầy đủ; `seed.sql` thêm dữ liệu vào PostgreSQL hoặc Supabase SQL Editor. SQL kiểm tra trùng email/MSSV và nghề nghiệp còn hoạt động, giữ nguyên dữ liệu cũ, kiểm tra số lượng trước khi commit và không tạo bản ghi trùng khi chạy lại cùng bộ dữ liệu. Database phải có sẵn ít nhất một tài khoản để xác định Entra tenant và danh mục nghề nghiệp tương ứng.

Chạy từ thư mục gốc repository để xuất lại các tệp vào `output/demo-accounts`:

```sh
node scripts/seed-demo-accounts.mjs --export
```

Để thêm vào database local được cấu hình trong `apps/api/.env`:

```sh
node scripts/seed-demo-accounts.mjs --apply-local
```

Lệnh local chỉ chấp nhận host `localhost` hoặc `127.0.0.1`. Với Supabase, chạy nội dung `seed.sql` trong SQL Editor của đúng dự án. Bộ dữ liệu này đã được thêm vào local và Supabase; không cần chạy lại để cập nhật mã nguồn từ GitHub.

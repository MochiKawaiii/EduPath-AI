# Sprint 2 — Quản lý hồ sơ sinh viên

## Phạm vi

| Mã | Chức năng | Triển khai |
| --- | --- | --- |
| AD-PROF-01 | Xem danh sách sinh viên | `/quantri/sinh-vien`, phân trang 10 dòng, dùng dữ liệu PostgreSQL. |
| AD-PROF-02 | Xem chi tiết hồ sơ | Hộp thoại mở từ tên sinh viên hoặc nút Xem hồ sơ; đóng bằng nút hoặc Escape, trả focus về nút mở. |
| AD-PROF-03 | Tìm kiếm | Từ khóa trên mã sinh viên, họ tên, email, username, mục tiêu nghề nghiệp; không phân biệt hoa/thường. |
| AD-PROF-04 | Lọc | Năm nhập học, học kỳ hiện tại, trạng thái hồ sơ và trạng thái tài khoản; kết hợp từ khóa và phân trang. |

Sidebar có hai mục: Danh sách tài khoản người dùng và Hồ sơ sinh viên. Không thêm trang công khai trước đăng nhập quản trị. Hỗ trợ mở trực tiếp URL, tải lại, Back/Forward. Nhóm tài khoản vẫn giữ các thao tác trong một trang như yêu cầu trước.

## Nguồn dữ liệu và giới hạn

- Dùng `users LEFT JOIN student_profiles`, không cần bảng hoặc migration mới, không tự thêm hồ sơ/sinh viên demo.
- Danh sách gồm tài khoản có **vai trò hiệu lực Student** (`COALESCE(role_override, role)`) trong tenant của quản trị viên; bao gồm tài khoản bị khóa và tài khoản chưa có hồ sơ. Không phải danh sách toàn bộ sinh viên VLU, không truy vấn hệ thống hồ sơ nhà trường.
- Tài khoản đã được đổi sang Admin không còn nằm trong nhóm Student. Nếu cần một người vừa là Admin vừa là sinh viên, cần mô hình vai trò đa nhiệm riêng ở giai đoạn sau.
- Trạng thái: `missing` = chưa có bản ghi `student_profiles`; `incomplete` = có bản ghi nhưng `onboarding_completed=false`; `complete` = cờ `onboarding_completed=true`. Không tự đánh dấu hoàn tất chỉ dựa vào số trường có dữ liệu.
- Thông tin chi tiết: họ tên, MSSV, email, username, năm nhập học, học kỳ, mục tiêu nghề nghiệp, trạng thái tài khoản/hồ sơ, ngày tạo và các mốc cập nhật/đăng nhập. Thời gian hiển thị UTC+7.
- Trường chưa cung cấp hiển thị Chưa cập nhật/Chưa có dữ liệu; không suy đoán MSSV từ email, không tự điền ngày sinh, số điện thoại, khoa/ngành khi schema chưa có.
- Năm nhập học trong dropdown lấy từ các hồ sơ Student cùng tenant, không phụ thuộc kết quả từ khóa hiện tại. Học kỳ hợp lệ từ 1 đến 20 theo ràng buộc database.
- Chỉ xem/tìm/lọc. Không cung cấp API tạo, sửa, xóa hồ sơ trong nhóm chức năng này.

## Backend

- `GET /api/admin/students`: `q` tối đa 120 ký tự; `page` 1–100000; `pageSize` 1–50; `cohortYear` 2000–2100; `semester` 1–3; `active=true|false`; `profileStatus=missing|incomplete|complete`.
- Trả `items`, `total`, `cohortYears`, `page`, `pageSize`. Tổng số và trang dữ liệu lấy trong cùng một truy vấn; sắp xếp tên, ID để phân trang ổn định.
- `GET /api/admin/students/:id`: UUID hợp lệ, trả `student`; người dùng khác tenant, không phải Student hoặc không tồn tại đều trả 404.
- Cả hai endpoint yêu cầu phiên Admin và kiểm tra lại Admin đang hoạt động trong database; middleware phiên hiện có vẫn kiểm tra phiên bản quyền/trạng thái.
- SQL có tham số, giới hạn tenant ở cả danh sách, chi tiết và danh sách năm nhập học; không trả token, mật khẩu, Entra object ID hoặc nội dung session. Phản hồi không cache. Preview không có database trả 503.

## Kiểm thử

Kết quả triển khai: 163 kiểm thử tự động đạt (140 API, 23 web), build thành công; đã kiểm tra PostgreSQL bằng bảng tạm và kiểm tra giao diện desktop/mobile/tablet bằng Playwright.

- `npm test`: kiểm thử phân quyền, tham số không hợp lệ, bộ lọc kết hợp, chỉ đọc, tenant/effective-role scope và điều hướng quản trị.
- `npm run build`: kiểm tra TypeScript API/web và Vite.
- `output/playwright/student-profiles-postgres.mjs`: dữ liệu thử trong bảng TEMP của PostgreSQL local; kiểm tra thiếu hồ sơ, chi tiết, lọc/tìm, phân trang, cách ly tenant và vai trò. Không thay đổi dữ liệu thật.
- `output/playwright/student-profiles-checks.js`: giao diện với API giả lập, kiểm tra điều hướng, chi tiết, focus, tìm/lọc/phân trang, rỗng/lỗi/thử lại và responsive. Không thay thế nghiệm thu SSO thật.

Thiết kế dùng lại nhận diện EduPath/VLU và các thành phần chung từ trang tài khoản. UI/UX Pro Max hướng dẫn bố cục nhất quán, trạng thái thiếu dữ liệu, bàn phím và responsive.

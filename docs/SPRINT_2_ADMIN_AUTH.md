# Sprint 2 — Xác thực quản trị

## Nguồn yêu cầu

Danh sách mới: `requirements/Nhom1_DanhSachChucNang_ver0.2.xlsx`, sheet `FunctionList`.
Các dòng 60–69 đánh dấu Sprint 2: AD-AUTH-01 đến AD-AUTH-10.
Giữ nguyên workbook nguồn; không tự sửa phần trăm tiến độ hoặc ghi chú của nhóm.

Phạm vi triển khai lần này:

| Mã | Chức năng | Tiêu chí |
| --- | --- | --- |
| AD-AUTH-01 | Đăng nhập quản trị | Mở trực tiếp `/quantri`, không có trang giới thiệu hoặc liên kết Trang chủ trước đăng nhập; giao diện riêng; chỉ Admin được vào. |
| AD-AUTH-02 | Đăng xuất quản trị | Hủy session/cookie của ứng dụng, chuyển qua Microsoft logout và trả về màn hình đăng nhập `/quantri`. |
| AD-AUTH-03 | Tạo tài khoản quản trị | Nút trong danh sách; thêm quyền quản trị cho người dùng đã đăng nhập Microsoft vào EduPath. |
| AD-AUTH-04 | Danh sách tài khoản | Dữ liệu PostgreSQL cùng tenant, tìm kiếm, phân trang và lọc vai trò/trạng thái. |
| AD-AUTH-05 | Chi tiết tài khoản | Hộp thoại họ tên, email, tên đăng nhập, vai trò, trạng thái và các mốc thời gian. |
| AD-AUTH-06 | Phân quyền | Chọn Admin/Student, xác nhận, lưu override và thu hồi phiên cũ. |
| AD-AUTH-07 | Khóa / mở | Xác nhận khóa/mở tài khoản EduPath; không thay đổi tài khoản Microsoft. |
| AD-AUTH-08 | Lịch sử đăng nhập | Xem toàn bộ tổ chức hoặc từng tài khoản ngay trong danh sách. |
| AD-AUTH-09 | Tìm kiếm thông tin đăng nhập | Tìm theo tên, email, username hoặc mã kết quả trong lịch sử. |
| AD-AUTH-10 | Lọc thông tin đăng nhập | Lọc kết quả, cổng đăng nhập, khoảng ngày; kết hợp từ khóa và phân trang. |

## Thiết kế và xác thực

- Dùng Microsoft Entra ID hiện có, không tạo thêm mật khẩu nội bộ.
- Bố cục hai cột đỏ trầm/trắng, nhận diện Văn Lang; responsive, trạng thái tải/lỗi/thử lại.
- Quyền được ưu tiên từ `users.role_override` trong PostgreSQL (gắn với cặp tenant/object ID đã được Microsoft xác thực). Nếu NULL, backend ánh xạ app role Microsoft hoặc vai trò mặc định. Không cấp quyền dựa trên URL hoặc chỉ dựa vào đuôi email.
- Luồng đăng nhập `/quantri` kiểm tra quyền trước khi lưu người dùng và tạo session mới. Student bị từ chối; phiên Student sẵn có không bị nâng quyền.
- `GET /api/admin/me` và `/api/admin/summary` được bảo vệ bằng `requireRole("admin")`: chưa đăng nhập trả 401; không đủ quyền trả 403.
- `POST /api/auth/logout?portal=admin` chỉ chọn đích cố định `/quantri`, không nhận URL tùy ý; vẫn kiểm tra Origin, hủy session và xóa cookie.
- API xác thực/quản trị không được cache. Trang quản trị kiểm tra lại phiên khi được khôi phục từ browser back/forward cache.
- Admin đăng nhập qua màn hình sinh viên cũng được điều hướng về `/quantri`.
- Trang sau đăng nhập là khu vực quản lý tài khoản với sidebar riêng; chưa phải dashboard thống kê AD-REPORT-01.

## Kiểm tra và vận hành

- Chạy `npm test` và `npm run build` tại thư mục dự án.
- Kiểm tra trực tiếp `/quantri` với tài khoản Microsoft có app role `Admin` hoặc được gán `role_override = 'admin'` trong PostgreSQL. Không cung cấp mật khẩu/secret trong chat.
- Kiểm tra nút đăng xuất trả về đúng `/quantri` trên môi trường deploy, cùng cấu hình Microsoft Entra tương ứng.
- Kiểm thử trình duyệt tự động sử dụng phản hồi API giả lập cho trạng thái Admin, Student, chưa đăng nhập, lỗi mạng và lỗi đăng xuất; không thay thế nghiệm thu SSO thật.
- Migration `004_account_activity.sql` thêm `users.auth_version` và bảng `login_events`. Mặc định API chạy migration khi khởi động; nếu `DATABASE_AUTO_MIGRATE=false`, chạy `npm run db:migrate --workspace @edupath/api` trước khi chạy phiên bản mới. Database Render cần migration riêng, không đồng bộ dữ liệu từ local.

## Quản lý tài khoản — AD-AUTH-03 đến AD-AUTH-10

- Nhóm tài khoản chỉ có một mục **Danh sách tài khoản người dùng**, tại `/quantri/tai-khoan`. Nút tạo quản trị viên nằm phía trên; chi tiết, phân quyền, khóa/mở và lịch sử nằm ở từng dòng. Chế độ xem Lịch sử đăng nhập nằm trong cùng trang, không có danh mục riêng. Sidebar bổ sung nhóm Hồ sơ sinh viên tại `/quantri/sinh-vien`; xem `SPRINT_2_STUDENT_PROFILES.md`.
- AD-AUTH-03 hiện hỗ trợ thêm quản trị viên từ người dùng đã đăng nhập Microsoft vào EduPath ít nhất một lần, cùng tenant với quản trị viên thao tác. Nhập email và xác nhận cấp quyền; backend cập nhật `role` và `role_override` thành `admin`. Không tạo hộp thư Microsoft, mật khẩu nội bộ hoặc danh tính Microsoft giả. Luồng mời email chưa từng đăng nhập chưa triển khai.
- AD-AUTH-04 hiển thị danh sách thật từ PostgreSQL: họ tên, email, vai trò hiệu lực, trạng thái và lần đăng nhập gần nhất; hỗ trợ tìm kiếm, phân trang, trạng thái tải/lỗi/thử lại/rỗng.
- `GET /api/admin/accounts` giới hạn dữ liệu cùng tenant, kiểm tra tham số tìm kiếm và phân trang; truy vấn SQL có tham số.
- `POST /api/admin/accounts` yêu cầu đúng Origin, email hợp lệ và xác nhận cấp quyền. Giao dịch kiểm tra lại quyền người thao tác, từ chối tài khoản bị khóa, email không tồn tại/không xác định duy nhất, khác tenant hoặc đã là quản trị viên.
- API quản lý tài khoản kiểm tra lại quyền Admin đang hoạt động trong database mỗi lần gọi, kể cả khi session cũ còn quyền. Khi không cấu hình database, trả lỗi rõ ràng thay vì giả lập lưu thành công.
- `GET /api/admin/accounts/:id` lấy chi tiết; `PATCH /api/admin/accounts/:id` nhận đúng một thay đổi `role` hoặc `isActive`, kèm `confirmed=true` và Origin hợp lệ. Không nhận thay đổi tenant hay trường ngoài hợp đồng.
- Không tự đổi vai trò/khóa/mở tài khoản đang sử dụng. Các thay đổi trong tenant được tuần tự hóa bằng transaction advisory lock, kiểm tra lại actor đang hoạt động trước khi sửa đích. Vì actor phải còn Admin và không thể sửa chính mình, các thao tác này không loại bỏ quản trị viên hoạt động cuối cùng.
- `GET /api/admin/accounts/history` nhận `q`, `userId`, `outcome`, `portal`, `from`, `to`, `page`, `pageSize`. `from` bao gồm, `to` không bao gồm; UI chuyển ngày Việt Nam UTC+7 sang ISO và bao gồm toàn bộ ngày kết thúc. Giới hạn 50 dòng/trang; không trả token, mật khẩu hoặc nội dung phiên.
- `login_events` chỉ lưu sự kiện đăng nhập EduPath từ lúc bật tính năng: thành công hoặc từ chối sau khi xác minh danh tính Microsoft được phép và tìm được người dùng trong database. Không lấy lịch sử Entra trước đây, không tạo lại sự kiện quá khứ; callback chưa xác định tài khoản (hủy Microsoft, sai state, sai tenant) không được gán tùy tiện cho người dùng.
- Nếu lưu lịch sử thành công bị lỗi, phiên vừa tạo bị hủy và đăng nhập báo lỗi; không âm thầm bỏ mất sự kiện đăng nhập thành công.
- Giao diện lấy cảm hứng bố cục quản trị VLU, áp dụng UI/UX Pro Max cho điều hướng, tương phản, focus bàn phím và responsive; không thay đổi trang đăng nhập sinh viên.
- Kiểm chứng: 130 kiểm thử tự động đạt; build thành công. Playwright kiểm tra menu thống nhất, chi tiết/thử lại/focus, xác nhận phân quyền, khóa/mở, lịch sử toàn cục/từng người dùng, bộ lọc ngày, tìm kiếm, phân trang, lỗi tạo tài khoản, desktop và mobile. PostgreSQL thật được kiểm tra qua bảng TEMP riêng; không thay đổi quyền/trạng thái tài khoản thật khi kiểm thử.

## Quyền gán tại PostgreSQL

- Migration `003_user_role_override.sql` bổ sung quyền chỉ định riêng. Giá trị hợp lệ: `admin`, `student`, hoặc NULL để dùng quyền Microsoft/mặc định.
- Khi cấp quyền thủ công, cập nhật cả `role_override` và `role` cho đúng ID người dùng đã được xác thực. Không tự tạo danh tính Microsoft dựa trên email.
- Upsert đăng nhập giữ `role_override`, không ghi đè bằng Student mặc định. Tài khoản bị khóa không được đăng nhập.
- Thay đổi bằng API tăng `auth_version` và xóa các phiên của đúng tài khoản trong cùng transaction. Middleware kiểm tra trạng thái, vai trò hiệu lực và phiên bản phiên trên các request API; phiên cũ không hoạt động trở lại sau khi mở khóa. Nếu chỉnh SQL thủ công, cũng phải tăng `auth_version` và thu hồi các phiên tương ứng. Frontend quản trị quay lại kiểm tra phiên khi API trả 401.
- Quyền trên PostgreSQL local không tự đồng bộ với database Render.

## Ghi chú xung đột yêu cầu

Workbook có ghi chú STU-AUTH-02 trở về Trang chủ sau đăng xuất. Yêu cầu chat gần nhất của người dùng đã chốt về `/login`, nên không thay đổi luồng sinh viên trong task này. Các ghi chú khác của Sprint 1 cũng chưa tự động triển khai.

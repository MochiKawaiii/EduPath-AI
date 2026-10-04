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
| AD-AUTH-03 | Tạo tài khoản quản trị | Nút trong danh sách; cấp quyền bằng email đăng nhập Microsoft, kể cả trước lần đăng nhập đầu tiên vào EduPath. |
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
- `GET /api/admin/me` và `/api/admin/summary` cho phép bốn vai trò Quản trị viên, Ban chủ nhiệm khoa, trưởng/phó bộ môn và giảng viên: chưa đăng nhập trả 401; Sinh viên không có quyền truy cập và nhận 403.
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
- AD-AUTH-03 cho phép nhập email Microsoft và xác nhận cấp quyền ngay cả khi người dùng chưa đăng nhập EduPath. Nếu chưa có tài khoản, backend tạo tài khoản chờ trong tenant của quản trị viên, với `role` và `role_override` là `admin`, danh tính Microsoft và ngày đăng nhập để NULL. Nếu đã có một tài khoản duy nhất, backend nâng quyền tài khoản đó và thu hồi các phiên cũ. Không tạo hộp thư, mật khẩu hoặc danh tính Microsoft giả.
- Lần đăng nhập đầu đọc quyền chờ trước khi kiểm tra cổng quản trị, sau đó liên kết với tenant/object ID thật trong giao dịch. Chỉ đối chiếu địa chỉ đăng nhập Microsoft (`preferred_username`) trong cùng tenant cho tài khoản chưa liên kết; không đối chiếu claim email hay gộp tài khoản đã liên kết. Sau khi liên kết, tenant/object ID là định danh duy nhất. Hai lần đăng nhập đồng thời không được nhận cùng một quyền chờ cho hai object ID khác nhau.
- AD-AUTH-04 hiển thị danh sách thật từ PostgreSQL: họ tên, email, vai trò hiệu lực, trạng thái và lần đăng nhập gần nhất; hỗ trợ tìm kiếm, phân trang, trạng thái tải/lỗi/thử lại/rỗng.
- `GET /api/admin/accounts` kiểm tra tham số tìm kiếm và phân trang; truy vấn SQL có tham số. Tài khoản chưa đăng nhập hiển thị “Chưa đăng nhập” thay cho ngày đầu/gần nhất.
- `POST /api/admin/accounts` yêu cầu đúng Origin, email hợp lệ và xác nhận cấp quyền. Giao dịch kiểm tra lại quyền người thao tác, từ chối tài khoản bị khóa, email không xác định duy nhất hoặc đã là quản trị viên. Email chưa có được tạo dưới dạng tài khoản chờ, không còn yêu cầu đăng nhập trước.
- Migration `017_precreated_accounts.sql` cho phép các trường danh tính/ngày đăng nhập để NULL đối với tài khoản chờ và bảo đảm địa chỉ chờ duy nhất trong tenant. Chạy `node scripts/verify-precreated-accounts.mjs` sau build để kiểm tra tạo/liên kết và đăng nhập đồng thời trên schema tạm trong PostgreSQL local.
- API quản lý tài khoản kiểm tra vai trò quản lý đang hoạt động trong database mỗi lần gọi, kể cả khi session cũ còn quyền. Quản trị viên, Ban chủ nhiệm khoa, trưởng/phó bộ môn và giảng viên đều được quản lý dữ liệu, xem lịch sử và khóa/mở tài khoản. Chỉ Quản trị viên được đổi vai trò và tạo/cấp tài khoản quản trị. Khi không cấu hình database, trả lỗi rõ ràng thay vì giả lập lưu thành công.
- `GET /api/admin/accounts/:id` lấy chi tiết; `PATCH /api/admin/accounts/:id` nhận đúng một thay đổi `role` hoặc `isActive`, kèm `confirmed=true` và Origin hợp lệ. Không nhận thay đổi tenant hay trường ngoài hợp đồng.
- Không tự đổi vai trò/khóa/mở tài khoản đang sử dụng. Các thay đổi trong tenant được tuần tự hóa bằng transaction advisory lock, kiểm tra lại actor đang hoạt động trước khi sửa đích. Không cho khóa Quản trị viên đang hoạt động cuối cùng. Thao tác đổi vai trò luôn kiểm tra riêng quyền Admin trong giao dịch; thao tác khóa/mở cho phép cả bốn vai trò quản lý.
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

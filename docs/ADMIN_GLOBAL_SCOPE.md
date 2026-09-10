# Phạm vi quản trị toàn hệ thống — 10/09/2026

Theo yêu cầu mới, Admin quản lý tất cả người dùng đã đăng nhập EduPath trong database chung, không giới hạn tenant Microsoft hoặc tên miền email. Quy định này thay thế mô tả phạm vi cùng tenant trong tài liệu Sprint 2.

- Danh sách tài khoản, chi tiết, tìm kiếm, lọc và lịch sử đăng nhập áp dụng toàn hệ thống.
- Hồ sơ sinh viên hiển thị mọi tài khoản có vai trò hiệu lực Student, kể cả chưa bổ sung hồ sơ; Admin không nằm trong danh sách sinh viên.
- Cấp quyền Admin, phân quyền, khóa/mở tài khoản áp dụng giữa các tenant. Email trùng nhiều danh tính vẫn bị từ chối khi cấp quyền bằng email; có thể chọn đúng dòng tài khoản và phân quyền theo ID.
- Mọi API quản trị vẫn kiểm tra phiên và quyền Admin đang hoạt động trong database. Tenant vẫn được dùng để xác minh danh tính người thao tác và liên kết đúng lịch sử, không dùng để giới hạn danh sách mục tiêu.
- Thay đổi vai trò/trạng thái dùng chung khóa giao dịch toàn hệ thống, kiểm tra lại quyền người thao tác, chặn tự sửa quyền/trạng thái và thu hồi phiên của tài khoản bị thay đổi.
- Không thay đổi tenant, ID hoặc dữ liệu người dùng hiện có. Không cần migration hoặc đổi biến môi trường cho thay đổi phạm vi này.

Không chạy build, kiểm thử tự động hoặc smoke test theo yêu cầu người dùng. Các kỳ vọng kiểm thử cũ được cập nhật theo phạm vi mới nhưng chưa được chạy.

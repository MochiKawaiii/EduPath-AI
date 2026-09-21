# Xem kế hoạch đào tạo

Sinh viên mở **Kế hoạch đào tạo** ngay sau **Chương trình đào tạo** trong menu tài khoản hoặc menu bên trái (`/dashboard#plans`).

Trang hiển thị kế hoạch đang mở, gợi ý khi có đúng một kế hoạch cùng khóa hồ sơ. Sinh viên được chọn kế hoạch khác để tham khảo, tìm môn theo mã/tên và lọc năm học–học kỳ. Bảng trình bày tín chỉ, loại môn, nhóm học và điều kiện tiên quyết/học trước theo dữ liệu kế hoạch. Không dùng tổng tất cả lựa chọn để suy ra tín chỉ phải học.

API `/api/student/plans` và `/api/student/plans/:id` chỉ đọc, kiểm tra phiên đăng nhập và trạng thái tài khoản. Chỉ trả phiên bản hiện hành của kế hoạch đang mở; không trả lịch sử, token quản trị, file nguồn hoặc ô Excel. Không cần migration mới. Tải lại trang hoặc quay lại tab để nhận thay đổi từ quản trị viên. Đây là kế hoạch giảng dạy, không phải đăng ký học phần cá nhân.

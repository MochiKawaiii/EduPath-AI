# Không gian sinh viên

Trang `/dashboard` dùng bố cục sidebar, thanh công cụ, ba thẻ truy cập nhanh, hồ sơ học tập và cột mục tiêu nghề nghiệp. Chỉ tham khảo cấu trúc giao diện từ ảnh người dùng cung cấp; nội dung được điều chỉnh theo chức năng EduPath.

- Tổng quan và hồ sơ hiển thị dữ liệu thật qua `GET /api/student/profile`. Endpoint yêu cầu Student và chỉ truy vấn ID lấy từ session, không nhận ID người khác từ trình duyệt. Phản hồi không cache.
- Sidebar điều hướng qua hash, hỗ trợ Back/Forward và màn hình nhỏ. Tìm kiếm trên thanh công cụ tìm các chức năng trong sidebar.
- Đăng xuất dùng luồng Microsoft hiện có và hiển thị lỗi nếu thất bại.
- Bảng điểm, năng lực, nghề nghiệp, lộ trình, chương trình đào tạo và trợ lý AI có trạng thái chưa triển khai; không tạo điểm số, môn học hoặc kết quả AI giả.
- Không có migration mới. Không chạy build/test/smoke test theo yêu cầu người dùng.

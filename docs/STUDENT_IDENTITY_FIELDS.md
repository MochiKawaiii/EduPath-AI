# Thông tin sinh viên từ tên Microsoft

Mẫu `2374802010078 - Nguyễn Bảo Duy - 71K29CNTT08` được tách thành MSSV `2374802010078`, họ tên `Nguyễn Bảo Duy`, khóa `K29`, lớp `CNTT08`, năm nhập học `2023`.

Migration 005 thêm `full_name`, `cohort_code`, `class_name` vào `student_profiles`; dùng lại `student_code` và `cohort_year`. Năm nhập học = số khóa + 1994, áp dụng từ K27. Tiền tố `71` không thuộc tên lớp. Không suy ra học kỳ hiện tại.

Migration bổ sung hồ sơ từ tên của tài khoản hiện có và tạo trigger cho những lần tạo/cập nhật tên Microsoft tiếp theo. Chỉ các tên khớp đầy đủ mẫu được xử lý; dữ liệu hồ sơ đã có không bị ghi đè. Tên gốc trong `users.display_name` được giữ lại. Hồ sơ mới vẫn chưa hoàn tất onboarding.

Nếu MSSV đã thuộc danh tính khác, không gộp tài khoản và không gán lại MSSV đó; các thông tin còn lại vẫn được bổ sung. Migration 006 thu hồi quyền gọi các hàm đồng bộ từ các vai trò Data API của Supabase nếu tồn tại.

API hồ sơ trả tên đã tách, khóa và lớp. Danh sách và hộp thoại chi tiết cùng hiển thị các trường này; tìm kiếm hỗ trợ khóa/lớp và bộ lọc năm nhập học dùng dữ liệu đã lưu.

Đã áp dụng migration trên PostgreSQL local. Không chạy build hoặc test theo yêu cầu. Supabase cần áp dụng migration khi Render triển khai với `DATABASE_AUTO_MIGRATE=true`.

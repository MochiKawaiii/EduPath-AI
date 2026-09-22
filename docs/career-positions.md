# Vị trí nghề nghiệp — AD-CAREER-01..07

Danh mục ban đầu gồm 20 vị trí. Tên và kỹ năng là dữ liệu khởi tạo có thể chỉnh sửa, chưa phải bộ tiêu chí đánh giá năng lực hay yêu cầu tuyển dụng.

| Tiếng Việt | English |
| --- | --- |
| Lập trình viên giao diện web | Frontend Developer |
| Lập trình viên phía máy chủ | Backend Developer |
| Lập trình viên toàn diện | Full-stack Developer |
| Lập trình viên ứng dụng di động | Mobile Developer |
| Lập trình viên trò chơi | Game Developer |
| Kỹ sư phần mềm | Software Engineer |
| Kỹ sư dữ liệu | Data Engineer |
| Chuyên viên phân tích dữ liệu | Data Analyst |
| Nhà khoa học dữ liệu | Data Scientist |
| Kỹ sư học máy | Machine Learning Engineer |
| Kỹ sư trí tuệ nhân tạo | AI Engineer |
| Chuyên viên phân tích an toàn thông tin | Cybersecurity Analyst |
| Chuyên viên kiểm thử xâm nhập | Penetration Tester |
| Kỹ sư DevOps | DevOps Engineer |
| Kỹ sư điện toán đám mây | Cloud Engineer |
| Kỹ sư mạng | Network Engineer |
| Quản trị viên hệ thống | System Administrator |
| Kỹ sư kiểm thử phần mềm | QA/Test Engineer |
| Chuyên viên phân tích nghiệp vụ CNTT | IT Business Analyst |
| Nhà thiết kế trải nghiệm và giao diện | UX/UI Designer |

Quản trị viên thêm/sửa/xóa; các vai trò khoa, bộ môn và giảng viên chỉ xem. Xóa là ngừng hiển thị trong danh sách chọn mới, giữ liên kết với hồ sơ đã chọn. Sinh viên chọn một vị trí hoặc bỏ chọn; vị trí đã chọn là mục tiêu nghề nghiệp, không còn ô mục tiêu nhập tay. Lớp học chỉ xem, không cho sinh viên chỉnh sửa. Không tự ánh xạ văn bản cũ sang vị trí để tránh đoán sai.

Migration `014_career_positions.sql` tạo danh mục và thêm liên kết từ hồ sơ; 20 vị trí chỉ khởi tạo một lần, không tự phục hồi vị trí đã xóa khi khởi động.

## Sử dụng

- Admin: **Vị trí nghề nghiệp** tại `/quantri/vi-tri-nghe-nghiep`. Tìm bằng tên Việt/Anh, mã hoặc kỹ năng; tìm không dấu được hỗ trợ. Bộ lọc lĩnh vực áp dụng ngay khi chọn.
- Sinh viên: **Hồ sơ & bảng điểm → Thông tin cá nhân → Chỉnh sửa thông tin → Vị trí nghề nghiệp mong muốn**. Chọn một vị trí, rồi lưu thay đổi. Có thể bỏ chọn. Văn bản mục tiêu cũ được giữ trong cơ sở dữ liệu nhưng không hiển thị và không tính vào trạng thái hoàn tất hồ sơ.
- Các vị trí đều có mã, tên Việt/Anh, lĩnh vực, mô tả và danh sách kỹ năng tham khảo. Dữ liệu này có thể tiếp tục được ánh xạ với đánh giá năng lực/lộ trình trong các chức năng sau.

API admin nằm tại `/api/admin/careers`, danh mục cho sinh viên tại `/api/student/careers`. Trường hồ sơ `careerPositionId` lưu UUID của vị trí; bỏ trường này trong yêu cầu cập nhật sẽ giữ nguyên lựa chọn cũ, gửi `null` sẽ bỏ chọn. Không chấp nhận lựa chọn mới trỏ đến vị trí đã xóa. Các thao tác sửa/xóa vị trí kiểm tra phiên bản để tránh ghi đè cập nhật đồng thời.

Khi deploy với `DATABASE_AUTO_MIGRATE=true`, backend áp dụng migration và khởi tạo danh mục. Không cần tải file hay chạy import cho 20 vị trí ban đầu.

## Kiểm tra

Test API nằm trong `apps/api/src/careers/router.test.ts` và `apps/api/src/student/career-profile.test.ts`. Sau khi build, chạy `node scripts/verify-careers.mjs` để kiểm tra migration, CRUD, tìm kiếm, quyền truy cập và lựa chọn hồ sơ trên PostgreSQL localhost. Script chỉ ghi vào schema thử nghiệm riêng và dọn schema khi kết thúc; từ chối URL database từ xa. Thêm `--ui` để giữ fixture giao diện, kết thúc bằng Ctrl+C để dọn dữ liệu thử nghiệm.

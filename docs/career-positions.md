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

## Lĩnh vực nghề nghiệp — AD-FIELD-01..04

Trong trang **Vị trí nghề nghiệp**, nút **Quản lý lĩnh vực** mở hộp thoại danh sách và tìm kiếm. Quản trị viên có thể thêm, chỉnh sửa tên/mô tả và xóa lĩnh vực; các vai trò khoa, bộ môn và giảng viên dùng nút **Xem lĩnh vực** để xem. Form thêm/sửa/xóa thay nội dung hộp thoại danh sách; hủy hoặc lưu sẽ trở lại danh sách lĩnh vực.

Migration `015_career_fields.sql` chuyển 6 lĩnh vực hiện có thành danh mục trong database và giữ liên kết với các vị trí đã có. Danh sách vị trí, bộ lọc và hộp thoại dùng chung dữ liệu lĩnh vực; lưu thay đổi sẽ tải lại danh mục và vị trí. Lĩnh vực mới được dùng ngay trong bộ lọc và form vị trí nghề nghiệp; đổi tên cũng cập nhật nhãn lĩnh vực của các vị trí đã liên kết. Chỉ xóa bộ lọc lĩnh vực nếu lĩnh vực đang chọn không còn tồn tại. Tên lĩnh vực cập nhật cũng xuất hiện trong danh sách chọn nghề nghiệp của sinh viên.

Mỗi lĩnh vực có mã duy nhất, tên và mô tả. Mã gồm chữ thường, số, dấu gạch ngang hoặc gạch dưới và được giữ cố định sau khi tạo để bảo toàn liên kết. Không chấp nhận tên trùng trong các lĩnh vực đang hoạt động. Muốn xóa một lĩnh vực, cần chuyển hoặc xóa các vị trí đang liên kết trước. Xóa lĩnh vực là ngừng sử dụng, giữ dữ liệu lịch sử.

API quản lý gồm `GET/POST /api/admin/careers/fields` và `PATCH/DELETE /api/admin/careers/fields/:id`. Sửa/xóa yêu cầu `x-version`; xóa yêu cầu xác nhận. API kiểm tra quyền quản trị viên, nguồn yêu cầu và liên kết còn sử dụng trước khi thay đổi. Database khóa bản ghi lĩnh vực khi tạo/sửa vị trí và khi xóa lĩnh vực để tránh tạo liên kết đồng thời với thao tác xóa.

## Yêu cầu nghề nghiệp — AD-REQ-01..08

Trang quản trị chỉ có một danh sách **Vị trí nghề nghiệp**, không chia ba tab riêng. Nút **Chi tiết** trên mỗi dòng mở thông tin nghề và phần **Yêu cầu và kỹ năng** ngay bên dưới. Người có quyền xem có thể mở chi tiết yêu cầu, tìm kiếm không dấu và lọc theo kỹ năng, mức yêu cầu, loại và tính chất. Mọi thao tác và bộ lọc yêu cầu luôn giới hạn trong vị trí đang mở, kể cả khi xóa bộ lọc. Nút **Danh sách vị trí** quay lại và giữ bộ lọc/trang của danh sách. Quản trị viên thêm/cập nhật/xóa yêu cầu; tạo/cập nhật/xóa liên kết kỹ năng. Hủy ở trái, lưu/xóa ở phải trong hộp thoại.

Yêu cầu gồm nghề, nội dung, mô tả, mức yêu cầu (chưa xác định/cơ bản/trung cấp/nâng cao) và tính chất bắt buộc/ưu tiên. Khi tạo liên kết, chọn kỹ năng có sẵn hoặc nhập kỹ năng mới. Một kỹ năng có thể liên kết nhiều nghề với mức yêu cầu khác nhau; mỗi nghề chỉ có một liên kết hoạt động với cùng kỹ năng. Form tự gắn với nghề đang mở; chỉnh sửa cho phép đổi kỹ năng liên kết. Xóa liên kết không xóa kỹ năng dùng chung hoặc các liên kết ở nghề khác.

Migration `016_career_requirements.sql` tạo danh mục kỹ năng và yêu cầu, chuyển kỹ năng tham khảo hiện có thành liên kết với mức chưa xác định và không bắt buộc. Không tự suy đoán trình độ hay yêu cầu tuyển dụng. Các liên kết đồng bộ với danh sách kỹ năng và tìm kiếm ở vị trí nghề nghiệp, gồm danh mục sinh viên. Khi cập nhật nghề qua API cũ có gửi `skills`, các liên kết giữ lại vẫn giữ nguyên mô tả/mức yêu cầu; kỹ năng bỏ khỏi mảng sẽ ngừng liên kết. Nếu không gửi `skills` khi chỉnh sửa nghề, giữ nguyên các liên kết hiện có. Form chỉnh sửa nghề giữ nguyên liên kết; quản lý kỹ năng trong phần chi tiết vị trí.

API: `GET/POST /api/admin/careers/requirements`, `GET/PATCH/DELETE /api/admin/careers/requirements/:id`, và `GET /api/admin/careers/requirements/skills`. Sửa/xóa kiểm tra `x-version`, xóa cần xác nhận. Các thao tác ghi kiểm tra quyền quản trị viên trong transaction và khóa nghề liên quan trước khi đổi dữ liệu. Thay đổi yêu cầu cũng đổi phiên bản nghề để ngăn form cũ ghi đè kỹ năng. Nghề đã xóa không hiện yêu cầu và không cho thêm/sửa/xóa yêu cầu qua danh mục hoạt động.

## Kiểm tra

Test API nằm trong `apps/api/src/careers/router.test.ts`, `apps/api/src/careers/requirements.test.ts` và `apps/api/src/student/career-profile.test.ts`. Sau khi build, chạy `node scripts/verify-careers.mjs` để kiểm tra migration, CRUD, tìm kiếm, quyền truy cập, đồng bộ yêu cầu/kỹ năng và lựa chọn hồ sơ trên PostgreSQL localhost. Script chỉ ghi vào schema thử nghiệm riêng và dọn schema khi kết thúc; từ chối URL database từ xa. Thêm `--ui` để giữ fixture giao diện, kết thúc bằng Ctrl+C để dọn dữ liệu thử nghiệm.

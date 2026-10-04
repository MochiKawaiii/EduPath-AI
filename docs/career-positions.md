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

Quản trị viên, Ban chủ nhiệm khoa, trưởng/phó bộ môn và giảng viên đều được thêm/sửa/xóa và import dữ liệu nghề nghiệp. Chỉ Quản trị viên được phân quyền tài khoản. Xóa là ngừng hiển thị trong danh sách chọn mới, giữ liên kết với hồ sơ đã chọn. Sinh viên chọn một vị trí hoặc bỏ chọn; vị trí đã chọn là mục tiêu nghề nghiệp, không còn ô mục tiêu nhập tay. Lớp học chỉ xem, không cho sinh viên chỉnh sửa. Không tự ánh xạ văn bản cũ sang vị trí để tránh đoán sai.

Migration `014_career_positions.sql` tạo danh mục và thêm liên kết từ hồ sơ; 20 vị trí chỉ khởi tạo một lần, không tự phục hồi vị trí đã xóa khi khởi động.

## Sử dụng

- Admin: **Quản lý nghề nghiệp** tại `/quantri/vi-tri-nghe-nghiep`, breadcrumb **Nghề nghiệp**. Tìm bằng tên Việt/Anh, mã hoặc kỹ năng; tìm không dấu được hỗ trợ. Bộ lọc lĩnh vực áp dụng ngay khi chọn.
- Admin: **Lĩnh vực nghề nghiệp** là mục riêng trong menu trái tại `/quantri/linh-vuc-nghe-nghiep`. Trang này có danh sách, tìm kiếm, thêm, sửa và xóa lĩnh vực; không nằm trong hộp thoại của trang Quản lý nghề nghiệp.
- Sinh viên: **Hồ sơ & bảng điểm → Thông tin cá nhân → Chọn nghề nghiệp**. Chọn một vị trí trong danh sách rồi bấm **Lưu** để lưu ngay, hoặc mở yêu cầu/kỹ năng trước khi chọn mục tiêu. Có thể bỏ chọn trong form hồ sơ. Văn bản mục tiêu cũ được giữ trong cơ sở dữ liệu nhưng không hiển thị và không tính vào trạng thái hoàn tất hồ sơ.
- Form tạo vị trí chỉ có mã, tên Việt/Anh, lĩnh vực và mô tả; không nhập kỹ năng tại đây. Lưu thành công trở về danh sách. Nút **Kỹ năng liên kết** cạnh **Thêm vị trí nghề nghiệp** mở khu vực riêng: chọn vị trí, rồi dùng **Thêm kỹ năng liên kết / Thêm yêu cầu** để quản lý nội dung, mức yêu cầu và tính chất.

API admin nằm tại `/api/admin/careers`, danh mục cho sinh viên tại `/api/student/careers`. Trường hồ sơ `careerPositionId` lưu UUID của vị trí; bỏ trường này trong yêu cầu cập nhật sẽ giữ nguyên lựa chọn cũ, gửi `null` sẽ bỏ chọn. Không chấp nhận lựa chọn mới trỏ đến vị trí đã xóa. Các thao tác sửa/xóa vị trí kiểm tra phiên bản để tránh ghi đè cập nhật đồng thời.

Khi deploy với `DATABASE_AUTO_MIGRATE=true`, backend áp dụng migration và khởi tạo danh mục. Không cần tải file hay chạy import cho 20 vị trí ban đầu.

## Lĩnh vực nghề nghiệp — AD-FIELD-01..04

Mục **Lĩnh vực nghề nghiệp** trong menu trái mở trang danh sách và tìm kiếm. Cột **Thao tác** dùng nút ba chấm dọc; bấm để mở menu **Chi tiết**, **Chỉnh sửa** và **Xóa**. Chi tiết hiển thị mã, tên và mô tả lĩnh vực. Quản trị viên và các vai trò khoa, bộ môn, giảng viên đều có thể thêm, chỉnh sửa tên/mô tả và xóa lĩnh vực. Form thêm/sửa/xóa mở hộp thoại trên trang này; hủy hoặc lưu sẽ đóng hộp thoại và giữ danh sách, bộ lọc đang xem.

Migration `015_career_fields.sql` chuyển 6 lĩnh vực hiện có thành danh mục trong database và giữ liên kết với các vị trí đã có. Hai trang quản lý dùng chung dữ liệu lĩnh vực; lưu thay đổi tải lại danh mục, và khi chuyển sang Quản lý nghề nghiệp trang này lấy danh mục mới nhất cho bộ lọc, form và nhãn lĩnh vực của các vị trí đã liên kết. Tên lĩnh vực cập nhật cũng xuất hiện trong danh sách chọn nghề nghiệp của sinh viên.

Mỗi lĩnh vực có mã duy nhất, tên và mô tả. Mã gồm chữ thường, số, dấu gạch ngang hoặc gạch dưới và được giữ cố định sau khi tạo để bảo toàn liên kết. Không chấp nhận tên trùng trong các lĩnh vực đang hoạt động. Muốn xóa một lĩnh vực, cần chuyển hoặc xóa các vị trí đang liên kết trước. Xóa lĩnh vực là ngừng sử dụng, giữ dữ liệu lịch sử.

API quản lý gồm `GET/POST /api/admin/careers/fields` và `PATCH/DELETE /api/admin/careers/fields/:id`. Sửa/xóa yêu cầu `x-version`; xóa yêu cầu xác nhận. API kiểm tra vai trò quản lý đang hoạt động, nguồn yêu cầu và liên kết còn sử dụng trước khi thay đổi. Database khóa bản ghi lĩnh vực khi tạo/sửa vị trí và khi xóa lĩnh vực để tránh tạo liên kết đồng thời với thao tác xóa.

## Danh sách kỹ năng

Mục **Danh sách kỹ năng** tại `/quantri/ky-nang` quản lý danh mục kỹ năng dùng chung trong database: tìm theo tên/mô tả, thêm, xem chi tiết, chỉnh sửa và xóa qua menu ba chấm dọc. Quản trị viên và các vai trò khoa, bộ môn, giảng viên đều được quản lý. Hủy/Đóng ở trái, Lưu/Xóa ở phải.

Migration `019_career_skill_management.sql` bổ sung mô tả, phiên bản và trạng thái ngừng sử dụng cho kỹ năng hiện có; giữ nguyên danh sách và các liên kết. Đổi tên cập nhật tên kỹ năng ở yêu cầu nghề nghiệp, cache kỹ năng và tìm kiếm của nghề, cùng danh mục sinh viên. Chỉ đổi tiêu đề yêu cầu nếu tiêu đề đang trùng tên kỹ năng cũ; giữ các tiêu đề tùy chỉnh, mô tả, mức yêu cầu và tính chất. Kỹ năng còn liên kết với vị trí đang hoạt động bị chặn xóa; cần vào **Quản lý nghề nghiệp → Kỹ năng liên kết**, chọn vị trí và gỡ liên kết trước. Xóa giữ dữ liệu lịch sử và loại kỹ năng khỏi dropdown, không cho liên kết mới bằng ID đã xóa.

API: `GET/POST /api/admin/careers/skills`, `PATCH/DELETE /api/admin/careers/skills/:id`. Tên kỹ năng đang hoạt động không trùng khi bỏ qua chữ hoa/thường. Sửa/xóa kiểm tra `x-version`; xóa yêu cầu xác nhận. Các thao tác ghi kiểm tra lại quyền trong transaction, và dùng chung khóa transaction với thao tác liên kết/đồng bộ kỹ năng để tránh xóa/đổi tên đồng thời gây sai liên kết hoặc cache.

## Yêu cầu nghề nghiệp — AD-REQ-01..08

Trang quản trị có danh sách **Vị trí nghề nghiệp** với menu ba chấm dọc **Chi tiết**, **Chỉnh sửa** và **Xóa** theo quyền quản lý. **Chi tiết** chỉ xem thông tin nghề và các yêu cầu/kỹ năng; không có nút thêm, chỉnh sửa hay xóa tại đây. Nút **Kỹ năng liên kết** trên thanh công cụ của danh sách mở khu vực quản lý riêng, với ô chọn vị trí lấy từ toàn bộ danh mục, độc lập bộ lọc danh sách. Quản trị viên và các vai trò khoa, bộ môn, giảng viên có thể thêm/cập nhật/xóa yêu cầu và liên kết kỹ năng ở khu vực này. Người có quyền xem vẫn có thể mở chi tiết yêu cầu, tìm kiếm không dấu và lọc theo kỹ năng, mức yêu cầu, loại và tính chất. Chuyển vị trí xóa bộ lọc/phân trang yêu cầu, còn lưu thay đổi giữ vị trí và bộ lọc đang xem. Nút **Danh sách vị trí** quay lại và giữ bộ lọc/trang của danh sách. Hủy ở trái, lưu/xóa ở phải trong hộp thoại.

Yêu cầu gồm nghề, nội dung, mô tả, mức yêu cầu (chưa xác định/cơ bản/trung cấp/nâng cao) và tính chất bắt buộc/ưu tiên. Khi tạo liên kết, chọn kỹ năng có sẵn hoặc nhập kỹ năng mới. Một kỹ năng có thể liên kết nhiều nghề với mức yêu cầu khác nhau; mỗi nghề chỉ có một liên kết hoạt động với cùng kỹ năng. Form tự gắn với nghề đang mở; chỉnh sửa cho phép đổi kỹ năng liên kết. Xóa liên kết không xóa kỹ năng dùng chung hoặc các liên kết ở nghề khác.

Migration `016_career_requirements.sql` tạo danh mục kỹ năng và yêu cầu, chuyển kỹ năng tham khảo hiện có thành liên kết với mức chưa xác định và không bắt buộc. Không tự suy đoán trình độ hay yêu cầu tuyển dụng. Các liên kết đồng bộ với danh sách kỹ năng và tìm kiếm ở vị trí nghề nghiệp, gồm danh mục sinh viên. Khi cập nhật nghề qua API cũ có gửi `skills`, các liên kết giữ lại vẫn giữ nguyên mô tả/mức yêu cầu; kỹ năng bỏ khỏi mảng sẽ ngừng liên kết. Nếu không gửi `skills` khi chỉnh sửa nghề, giữ nguyên các liên kết hiện có. Form chỉnh sửa nghề giữ nguyên liên kết; quản lý kỹ năng qua nút **Kỹ năng liên kết** trên danh sách.

API: `GET/POST /api/admin/careers/requirements`, `GET/PATCH/DELETE /api/admin/careers/requirements/:id`, và `GET /api/admin/careers/requirements/skills`. Sửa/xóa kiểm tra `x-version`, xóa cần xác nhận. Các thao tác ghi kiểm tra vai trò quản lý đang hoạt động trong transaction và khóa nghề liên quan trước khi đổi dữ liệu. Thay đổi yêu cầu cũng đổi phiên bản nghề để ngăn form cũ ghi đè kỹ năng. Nghề đã xóa không hiện yêu cầu và không cho thêm/sửa/xóa yêu cầu qua danh mục hoạt động.

`career_requirements` cùng liên kết đến `career_skills` là nguồn dữ liệu chuẩn cho yêu cầu của nghề, gồm nội dung, trình độ và tính chất. `career_positions.skills` là mảng tương thích/cache phục vụ tìm kiếm và hiển thị nhanh; không chỉnh sửa trực tiếp trên giao diện. Form tạo và sửa nghề đều không gửi `skills`. API cũ vẫn nhận `skills` để tương thích và đồng bộ các liên kết, không thay đổi metadata của liên kết được giữ lại. Khi xây dựng AI/skill-gap sau này, đọc yêu cầu có cấu trúc từ `career_requirements`, không suy luận yêu cầu/trình độ từ mảng cache.

## Nghề nghiệp trong hồ sơ sinh viên — STU-CAREER-01..04

**Khám phá nghề nghiệp** mở hộp thoại xem danh sách lĩnh vực (tên và mô tả), danh sách vị trí có tìm kiếm/lọc theo lĩnh vực và phân trang. Chọn **Xem yêu cầu** để đọc mô tả công việc cùng nội dung yêu cầu, kỹ năng/công nghệ, mức yêu cầu và tính chất bắt buộc/ưu tiên. **Xem yêu cầu nghề đã chọn** mở trực tiếp nghề mục tiêu hiện có. Nội dung dùng chung dữ liệu đang hoạt động do quản trị viên quản lý, lấy từ `career_requirements`/`career_skills`.

**Chọn làm mục tiêu nghề nghiệp** lưu ngay qua API hồ sơ, chỉ gửi `careerPositionId`; không cần bấm thêm **Lưu thay đổi**. Nút hiện trạng thái đang lưu và chặn thao tác lặp. Khi thành công, hộp thoại đóng, hồ sơ cập nhật và hiện thông báo đã lưu mục tiêu. Nếu thất bại, hộp thoại giữ mở, hiển thị lỗi và cho thử lại. Sở thích đã lưu và bản nháp sở thích đang nhập đều được giữ nguyên. Hủy form sau đó chỉ bỏ các chỉnh sửa chưa lưu, không hoàn tác mục tiêu đã lưu. **Bỏ chọn** trong form vẫn lưu qua **Lưu thay đổi**. Nghề đã ngừng sử dụng vẫn được giữ/hiển thị trong hồ sơ cũ, nhưng không có trong danh sách lựa chọn mới và không mở yêu cầu của nghề đã ngừng sử dụng.

`PATCH /api/student/profile` hỗ trợ cập nhật riêng mục tiêu: bỏ `interests` sẽ giữ nguyên sở thích trong cơ sở dữ liệu; gửi chuỗi hoặc `null` vẫn cập nhật/xóa sở thích như trước. Kiểm tra nghề đang hoạt động và giao dịch giữ nguyên để không ghi thay đổi khi nghề không khả dụng.

API đọc: `GET /api/student/careers/fields`, `GET /api/student/careers?q=...&category=...`, `GET /api/student/careers/:id`. Chi tiết chỉ trả thông tin nghề và các yêu cầu hoạt động, không trả phiên bản quản trị hay số sinh viên. API kiểm tra đăng nhập/tài khoản hoạt động, loại bỏ nghề/lĩnh vực đã xóa và từ chối mọi thao tác ghi vào danh mục qua tuyến sinh viên.

## Kiểm tra

Test API nằm trong `apps/api/src/careers/router.test.ts`, `apps/api/src/careers/requirements.test.ts`, `apps/api/src/careers/skills.test.ts` và `apps/api/src/student/career-profile.test.ts`. Sau khi build, chạy `node scripts/verify-careers.mjs` để kiểm tra migration, CRUD, tìm kiếm, quyền truy cập, đồng bộ yêu cầu/kỹ năng, thao tác kỹ năng đồng thời và lựa chọn hồ sơ trên PostgreSQL localhost. Script chỉ ghi vào schema thử nghiệm riêng và dọn schema khi kết thúc; từ chối URL database từ xa. Thêm `--ui` để giữ fixture giao diện, kết thúc bằng Ctrl+C để dọn dữ liệu thử nghiệm.

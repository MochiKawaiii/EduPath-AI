# Quản lý khung chương trình đào tạo

Truy cập **Quản trị → Chương trình đào tạo** tại `/quantri/chuong-trinh`.

## Sáu chức năng

- **Import:** chọn `.xlsx` không quá 5 MB, xem trước, đọc và xác nhận cảnh báo rồi lưu. Định dạng xác định bằng nội dung; tên tệp bất kỳ. Khung cùng ngành và khóa không được tạo trùng.
- **Danh sách và tìm kiếm:** tìm theo tên, ngành/chuyên ngành hoặc khóa. Gõ tìm kiếm cập nhật sau 300 ms; chọn khóa/trạng thái lọc ngay. Danh sách phân trang 10 khung.
- **Chi tiết:** xem các khối, học phần, nhóm tự chọn, học kỳ/năm học, tiên quyết/học trước và các điểm cần rà soát. Nút **Chi tiết** ở học phần có toàn bộ trường và các ô Excel gốc.
- **Cập nhật:** dùng biểu tượng bút ở đầu khung để sửa thông tin chương trình. Menu **…** cuối mỗi dòng **Khối kiến thức** cho phép thêm, sửa hoặc xóa môn trong khối. Form thêm/sửa có combobox khối kiến thức; khi thêm sẽ chọn sẵn khối vừa mở menu. Có thể chuyển môn sang khối khác, sửa mã và các trường học phần. Muốn thay toàn bộ cấu trúc khối, dùng **Cập nhật từ Excel** với tệp cùng ngành và khóa. Mỗi lần lưu tạo phiên bản mới; lịch sử và Excel nguồn được giữ lại.
- **Mở/khóa:** khóa khung không còn áp dụng, giữ lại dữ liệu để tra cứu. Có thể mở lại; trạng thái không bị thay đổi khi chạy đồng bộ các nguồn ban đầu.

Quản trị viên được thay đổi dữ liệu. Ban chủ nhiệm khoa, trưởng/phó bộ môn và giảng viên chỉ xem. Mọi thao tác ghi kiểm tra lại quyền trong database và phiên bản hiện hành; nếu khung đã được người khác sửa, tải lại trước khi lưu tiếp.

Xóa môn cần xác nhận và chỉ xóa khỏi phiên bản mới của khung đang mở, không xóa danh mục môn toàn hệ thống, khung khác hoặc lịch sử. Nếu môn bị xóa/đổi mã còn nằm trong điều kiện tiên quyết/học trước của môn khác, hệ thống giữ nguyên điều kiện đó và đánh dấu trong tab **Cảnh báo** để quản trị viên sửa. Tổng tín chỉ quy định không tự cộng/trừ khi thêm hoặc xóa môn vì có các nhóm tự chọn và chuyên ngành. Khối trống vẫn hiển thị để thêm môn lại.

**Tải khung CTĐT** tải Excel nguồn để đối chiếu; tệp này không bao gồm chỉnh sửa trực tiếp sau import. Những chỉnh sửa được lưu trong JSON và bảng học phần của phiên bản mới. Kế hoạch đào tạo đã liên kết với phiên bản CTĐT cũ vẫn giữ nguyên liên kết; trang sinh viên đọc phiên bản hiện hành của khung đang mở.

## Đồng bộ local và Render/Supabase

Migration `011_curricula.sql` tạo các bảng `curricula`, `curriculum_revisions`, `course_catalog`, `curriculum_courses`, `curriculum_relations`, `curriculum_events`. Mỗi khung có phiên bản JSON đầy đủ, bản Excel gốc và các bảng học phần/quan hệ để phục vụ truy vấn về sau.

Ba nguồn nằm trong `apps/api/data/curricula`: K29 có 88 học phần, K30 có 89, K31 có 89. Đây là **266 lượt học phần theo khung**, không phải 266 mã môn khác nhau. Giữ đúng file Mẫu Khoa người dùng cung cấp từ OneDrive; chưa nhập K32.

Khi backend khởi động với `DATABASE_AUTO_MIGRATE=true`, hệ thống chỉ chạy migration vào database được cấu hình bởi `DATABASE_URL`; backend **không tự nhập khung CTĐT**. Quản trị viên import khung trên trang quản trị. Local và Render có thể dùng hai database riêng; các sửa đổi ở hai database **không tự sao chép qua lại**.

Trên Render, giữ `DATABASE_URL` trỏ đến Supabase và `DATABASE_AUTO_MIGRATE=true`, deploy code mới như bình thường. Không cần sửa schema bằng tay hoặc dùng Supabase API key ở frontend. Để nạp nhanh ba khung K29–K31 vào một database trống, chạy tại thư mục gốc dự án:

```powershell
npm run db:seed-curricula --workspace @edupath/api
```

Lệnh đọc `apps/api/.env` theo cơ chế workspace hiện có; kiểm tra môi trường mục tiêu trước khi chạy. Lệnh chỉ thêm khung còn thiếu, không ghi đè phiên bản đã sửa, không tạo trùng và không mở lại khung đã khóa.

## Các điểm cần rà soát trong nguồn

- K29: ô tổng khối `#REF!`, các dòng chuyên đề tốt nghiệp bị lệch cột và một số lịch học chưa xác định.
- K30: giữ nguyên ký hiệu `BBKTL`; một số nhóm tự chọn chỉ có mã nhóm, không ghi rõ tín chỉ cần chọn trong cột loại học phần.
- K31: mã Toán rời rạc mới là `71ITMA10404`, có điều kiện học trước còn dùng `71ITMA10403`. Không tự gộp hai mã.
- Tham chiếu ngoài khung và điều kiện bằng văn bản được giữ nguyên, đánh dấu rà soát. Các ghi chú về lỗi nguồn vẫn được giữ như thông tin truy vết sau khi chỉnh sửa dữ liệu.
- Tổng 126 tín chỉ đọc từ tiêu đề CTĐT. Không cộng toàn bộ các phương án tự chọn/chuyên ngành để kết luận số tín chỉ tốt nghiệp.

## Cổng sinh viên — STU-CURR-01

Vào **Chương trình đào tạo** trong menu bên trái hoặc menu tài khoản, đường dẫn `/dashboard#curriculum`.

- Chỉ liệt kê các khung đang mở và bản hiện hành. Khung bị khóa không thể xem kể cả gọi trực tiếp bằng ID; sinh viên không được ghi dữ liệu hoặc xem lịch sử/Excel nguồn của quản trị viên.
- Nếu chỉ có một khung đang mở cùng khóa với hồ sơ, trang tự gợi ý khung đó. Đây là gợi ý theo khóa, không phải xác nhận chương trình chính thức được phân công. Nếu chưa có khung đúng khóa (ví dụ K32), hoặc chưa có khóa trong hồ sơ, trang báo rõ và cho chọn khung khác để tham khảo.
- Tìm tên hoặc mã học phần có/không dấu; lọc theo khối, bắt buộc/tự chọn, chuyên ngành, năm học, học kỳ 1–3. Bộ lọc cập nhật ngay khi chọn, tìm kiếm chờ 300 ms.
- Chọn tên môn để xem tín chỉ, mô tả, loại môn, tiên quyết và học trước riêng biệt, cùng lịch học dự kiến/bộ môn/giờ học. Có thể mở môn được tham chiếu trong điều kiện để tra cứu tiếp.
- Các mã hoặc điều kiện còn chưa rõ được ghi nhận là cần xác nhận với cố vấn học tập. Chức năng này chưa kết luận sinh viên đủ điều kiện đăng ký hay tốt nghiệp.
- Trang tải lại khi trở về tab hoặc bấm **Tải lại** để nhận phiên bản/trạng thái mới nhất.

**Mô tả môn học:** ba file Excel ban đầu không có mô tả chi tiết. Quản trị viên bổ sung qua **Chi tiết khung → Chi tiết học phần → Chỉnh sửa học phần → Mô tả học phần**. Nội dung lưu trong phiên bản JSON của học phần và hiển thị ở cổng sinh viên. Không suy diễn mô tả từ tên môn hoặc lấy ghi chú thay mô tả; khi chưa có dữ liệu, trang thông báo chưa được cung cấp. Không cần migration mới cho trường tùy chọn này.

## Các chức năng tiếp theo

Theo [kế hoạch](curriculum-plan.md), phần đối chiếu bảng điểm sẽ liên kết mã môn và phiên bản CTĐT. Sau đó bổ sung bảng tương đương được duyệt, quy tắc chọn chuyên ngành/nhóm tự chọn và điều kiện tốt nghiệp trước khi xây dựng thuật toán lộ trình. Các chức năng đó chưa được triển khai trong sáu mục quản trị này. K32 có thể thêm qua cùng luồng import khi có file chính thức; nếu trường đổi mẫu cột thì mở rộng bộ đọc trước.

## Kiểm tra

```powershell
npm run build
npm test
node scripts/verify-curricula.mjs
node scripts/verify-student-curricula.mjs
```

Hai script chỉ nhận database local và dùng schema tạm riêng. Script quản trị kiểm tra quyền, import, seed, tìm kiếm, phiên bản, cập nhật học phần, thay Excel và mở/khóa. Script sinh viên kiểm tra gợi ý theo khóa, dữ liệu K29–K31, cập nhật từ quản trị, ẩn khung khóa và quyền chỉ đọc. Schema được dọn khi lệnh kết thúc. Có thể thêm `--ui` để xem bản build trên máy với tài khoản giả lập, dữ liệu schema tạm; nhấn Ctrl+C để đóng và dọn schema. Chế độ này chỉ lắng nghe trên `127.0.0.1`, không dùng cho triển khai.

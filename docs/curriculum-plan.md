# Kế hoạch quản lý khung CTĐT — Sprint 3

## Phạm vi hiện tại

Triển khai AD-CURR-01–06 theo bảng yêu cầu trực tiếp: import, danh sách, tìm kiếm, chi tiết, cập nhật, mở/khóa. Dùng ba file Mẫu Khoa K29, K30, K31 trong OneDrive do người dùng cung cấp. K32 bổ sung sau; không dùng các file Downloads từ yêu cầu đã thay thế.

Function list Excel đảo thứ tự mã 01–04 và lặp nhóm kế hoạch đào tạo. Phạm vi triển khai theo sáu chức năng người dùng đã xác nhận, không tự tạo thêm chức năng tốt nghiệp hoặc lập kế hoạch trong sprint này.

## Các bước thực hiện

1. Đọc cấu trúc và kiểm tra dữ liệu nguồn; xác định môn bắt buộc, nhóm tự chọn, chuyên ngành, học kỳ/năm học và quan hệ học phần.
2. Tạo chương trình theo ngành + khóa, danh mục mã học phần, phiên bản bất biến, học phần từng phiên bản và quan hệ có nguồn gốc. Lưu Excel gốc và cảnh báo.
3. Import có xem trước, xác nhận cảnh báo và kiểm tra trùng. Cập nhật tạo phiên bản mới, kiểm tra version để tránh ghi đè thay đổi khác phiên. Mở/khóa là trạng thái chương trình, không xóa lịch sử.
4. Giao diện quản trị: danh sách/tìm kiếm/lọc tức thời, chi tiết theo khối và học kỳ, sửa thông tin/môn học, thay khung bằng Excel mới, mở/khóa. Chỉ admin được sửa; các vai trò khoa/bộ môn/giảng viên được xem.
5. Đồng bộ ba nguồn vào database local và Render/Supabase qua bước khởi tạo idempotent; không ghi đè chương trình đã tồn tại hoặc tự mở lại khung đã khóa.
6. Kiểm tra đủ số học phần và quan hệ, lỗi nguồn, quyền hạn, phiên bản, rollback và giao diện; build/test rồi đẩy GitHub.

## Các điểm dữ liệu cần giữ nguyên

- K29 có 88 mã học phần; K30 và K31 có 89 mã mỗi khung. Tổng 126 tín chỉ trong tiêu đề là yêu cầu của chương trình, không bằng tổng mọi lựa chọn học phần.
- Nhóm TC và các chuyên ngành là các lựa chọn, không coi tất cả môn là bắt buộc cho mọi sinh viên. Lưu nguyên BB/TC và yêu cầu tín chỉ ghi rõ; không suy ngược số tín chỉ phải chọn từ mã nhóm.
- Phân biệt học phần tiên quyết (K) với học trước (L). Giữ nguyên văn điều kiện và mã tham chiếu. Điều kiện nhiều chuyên ngành/văn bản quy định hoặc mã ngoài khung được đánh dấu cần rà soát, chưa đủ điều kiện đưa vào thuật toán lộ trình.
- Học kỳ chỉ 1–3; năm thứ lưu riêng. Giá trị 0, trống hoặc lệch cột thành chưa xác định kèm cảnh báo, không tự đoán.
- K29 có #REF! ở ô phụ/tổng khối và lệch cột các dòng chuyên đề tốt nghiệp. Vẫn giữ nguồn gốc và nhập các học phần hợp lệ; không sửa nghĩa dữ liệu gốc một cách ngầm định.
- K31 đổi mã Toán rời rạc từ 71ITMA10403 sang 71ITMA10404, nhưng có tham chiếu cũ. Không tự công nhận tương đương chỉ vì tên giống.

## Chuẩn bị cho các sprint sau

- Đối chiếu bảng điểm theo mã môn chính xác và phiên bản CTĐT gắn với khóa; mã khác cần bảng tương đương được duyệt riêng.
- Lộ trình cá nhân phải gắn revision cụ thể, chuyên ngành đã chọn, nhóm tự chọn, điều kiện tiên quyết/học trước và kế hoạch năm/học kỳ.
- Kiểm tra tốt nghiệp cần quy tắc tín chỉ, ngoại ngữ và môn điều kiện riêng; chưa kết luận tốt nghiệp từ 126 tín chỉ hoặc tổng danh mục.
- Gắn kỹ năng/chuẩn đầu ra vào mã môn và nội dung theo phiên bản sau khi có dữ liệu chính thức. Không tự sinh kỹ năng trong bước import.
- Thêm K32 bằng luồng import, không cần thay schema hoặc sửa khung khóa cũ.

## Kết quả triển khai ngày 15/09/2026

- Đã triển khai sáu chức năng và nhập ba khung vào database local: K29 88, K30 89, K31 89 học phần.
- Build thành công; 220 kiểm tra API/frontend đạt, trong đó 12 kiểm tra bộ đọc và dữ liệu mẫu. Kiểm tra tích hợp PostgreSQL đạt 9 nhóm tình huống về quyền, import, phiên bản, đồng bộ, tìm kiếm, cập nhật và mở/khóa.
- Đã xem giao diện danh sách/chi tiết ở desktop 1440 px và mobile 390 px, kiểm tra bộ lọc và luồng xem trước Excel/cảnh báo khung trùng bằng trình duyệt.
- Cơ chế khởi động Render tự chạy migration và nhập các khung chưa tồn tại khi `DATABASE_AUTO_MIGRATE=true`. Xác nhận trực tiếp nội dung Supabase sau triển khai cần phiên quản trị của môi trường đó.
- Hướng dẫn sử dụng và đồng bộ: [curriculum-guide.md](curriculum-guide.md).

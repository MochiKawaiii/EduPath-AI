# Quản lý kế hoạch đào tạo — AD-PLAN-01–06

Trang quản trị: `/quantri/ke-hoach`.

Quản trị viên có thể import, tìm kiếm, xem chi tiết, cập nhật và mở/khóa kế hoạch. Ban chủ nhiệm khoa, trưởng/phó bộ môn và giảng viên chỉ được xem. Quyền được kiểm tra lại ở API theo tài khoản hiện tại trong database.

## Nguồn và cấu trúc

Ba bản Excel người dùng cung cấp được lưu nguyên bản trong `apps/api/data/plans/`:

| Khóa | Số dòng phân bổ học phần | Số kỳ | Tổng tín chỉ ghi trong Excel |
| ---- | -----------------------: | ----: | ---------------------------: |
| K29  |                       73 |    10 |                          126 |
| K30  |                       70 |    10 |                          126 |
| K31  |                       74 |    10 |                          132 |

Số dòng phân bổ không phải số môn duy nhất hay số môn sinh viên phải học: có các nhóm lựa chọn, chuyên ngành và môn xuất hiện ở nhiều kỳ.

Parser đọc sheet có tiêu đề mã/tên học phần đúng mẫu kế hoạch của khoa. Không phụ thuộc tên file. Giữ các cột mã môn, tên, tín chỉ, loại môn, giờ LT/TH/ĐA/TT, tiên quyết, học trước, ghi chú, học kỳ và năm thứ. Học kỳ chỉ nhận 1–3; số thứ tự kỳ tích lũy trong cột A không dùng làm học kỳ.

Các công thức Excel được đọc từ kết quả đã lưu trong file, không gọi nguồn liên kết bên ngoài. File không có dữ liệu cần thiết hoặc lỗi công thức ở tên môn sẽ bị từ chối. Giới hạn upload 5 MB; có kiểm tra kích thước giải nén và thời gian parse.

Các điểm cần rà soát:

- K29 có GDTC thiếu tín chỉ/loại môn và một mã rơi vào phần chữ ký. Dòng chữ ký không được nhập thành môn.
- K31 có GDTC thiếu mã, tín chỉ; tổng nguồn 132 khác CTĐT 126; một nhóm ghi chọn 1 trong 2 nhưng chứa 4 dòng.
- Môn cùng mã ở nhiều kỳ được giữ riêng, không gộp mất phân bổ.
- Ô chưa có dữ liệu lưu `null` hoặc chuỗi rỗng theo loại trường; không biến thành 0 tín chỉ.

Các cảnh báo xuất hiện trong xem trước và chi tiết. Người import phải xác nhận đã rà soát trước khi lưu. Không tự sửa dữ liệu nguồn để khớp CTĐT.

## Luồng sử dụng

1. Chọn **Import kế hoạch**, tải Excel, xem trước cấu trúc và các cảnh báo.
2. Xác nhận rà soát và lưu. Nếu đã có cùng ngành/khóa, mở kế hoạch hiện tại để thay Excel.
3. Trong chi tiết, lọc theo kỳ, nhóm hoặc tìm mã/tên môn; mở từng dòng để xem đủ điều kiện và giờ học.
4. **Sửa thông tin** cập nhật tên, tổng tín chỉ và ghi chú. Mở **Chi tiết** một môn để xem và chỉnh sửa phân bổ, nội dung của dòng đó.
5. **Cập nhật từ Excel** dùng khi thêm/bớt môn, thay cấu trúc nhóm hoặc cập nhật toàn bộ kế hoạch.
6. Mở/khóa điều khiển trạng thái áp dụng. Trang quản trị vẫn xem được kế hoạch đã khóa để quản lý và đối chiếu lịch sử.

Sửa từng dòng không tự tính lại tổng tín chỉ nguồn vì nhóm lựa chọn và chuyên ngành có thể trùng nhau. Quản trị viên cập nhật tổng riêng khi đã kiểm tra quy tắc của kế hoạch.

## Database và các bước phát triển sau

Migration `012_training_plans.sql` tạo kế hoạch, phiên bản bất biến, các dòng phân bổ và nhật ký mở/khóa. Mỗi phiên bản giữ JSON chuẩn hóa, Excel gốc và hash nguồn. Các dòng có ID riêng, không lấy mã môn làm khóa duy nhất.

Kế hoạch được nối với phiên bản CTĐT cùng ngành/khóa tại lúc import. Khi sửa CTĐT về sau, lịch sử kế hoạch không đổi theo. Thay Excel sẽ đối chiếu với phiên bản CTĐT hiện tại; cập nhật thủ công giữ liên kết cũ. Nếu chưa có CTĐT tương ứng, hệ thống cảnh báo thay vì gán nhầm khung.

Đây là nền dữ liệu cho đối chiếu bảng điểm và gợi ý lộ trình: dùng mã môn để liên kết với CTĐT, dùng năm/học kỳ cho phân bổ, giữ điều kiện và nhóm lựa chọn nguồn. Những quy tắc nhóm còn mơ hồ cần khoa xác nhận trước khi dùng để tự động tính lộ trình. Chưa triển khai thuật toán tư vấn hoặc trang kế hoạch sinh viên trong AD-PLAN.

Mỗi lần cập nhật cần token phiên bản hiện tại để tránh ghi đè thay đổi của người khác. Import cần hash của bản xem trước; nếu khung liên kết thay đổi giữa lúc xem trước và lưu, cần xem trước lại.

## Đồng bộ và triển khai

Khi `DATABASE_AUTO_MIGRATE=true`, backend chỉ chạy migration lúc khởi động; backend không tự nạp CTĐT hay kế hoạch. Quản trị viên import CTĐT trước, rồi import kế hoạch cùng ngành/khóa để kế hoạch được liên kết.

Để nạp nhanh CTĐT và kế hoạch K29–K31 vào một database trống, chạy từ thư mục repository. Lệnh chỉ thêm bản chưa có cùng ngành/khóa, không ghi đè bản đã chỉnh và không tự mở lại bản đã khóa:

```powershell
npm run db:seed-plans --workspace @edupath/api
```

Lệnh dùng `DATABASE_URL` trong môi trường của API; kiểm tra đúng môi trường trước khi chạy. Trên Render, cần triển khai mã mới rồi backend khởi động thành công để migration áp dụng vào database đang cấu hình. Không lưu khóa bí mật trong mã nguồn.

Các bảng có RLS và không cấp quyền truy cập trực tiếp cho client Supabase; ứng dụng truy cập qua backend có kiểm tra quyền.

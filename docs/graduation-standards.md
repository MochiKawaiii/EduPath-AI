# Quản lý tiêu chuẩn xét tốt nghiệp — AD-GRAD-01..05

Vào **Quản trị → Tiêu chuẩn xét tốt nghiệp** (`/quantri/tieu-chuan-tot-nghiep`). Quản trị viên, Ban chủ nhiệm khoa, trưởng/phó bộ môn và giảng viên đều được import, thêm/sửa/xóa dữ liệu, mở/khóa và xem danh sách, chi tiết, lịch sử, nguồn. Chỉ Quản trị viên được phân quyền tài khoản.

## Import biểu mẫu

Chọn `.xls`, `.xlsx` hoặc ZIP chứa các biểu mẫu; tối đa 5 MB. Bấm **Đọc và xem trước**, kiểm tra từng sheet, chọn tiêu chuẩn cần lưu rồi xác nhận. ZIP được đọc trong bộ nhớ, không giải nén ra đường dẫn trên máy chủ. Tên tệp không quyết định cấu trúc dữ liệu.

Nguồn `OneDrive_2026-09-22.zip` có 9 workbook, 15 sheet tiêu chuẩn K26–K29. K27/K29 có nhiều sheet chuyên ngành. Hai bản K28 không chuyên ngành và hai bản K26 có cùng mã tiêu chuẩn/khối lớp: không tự quyết định bản nào là bản chính thức. Chỉ chọn một bản của mỗi tiêu chuẩn khi import mới; muốn áp dụng bản điều chỉnh, dùng **Cập nhật từ Excel** trên bản ghi hiện có. Cả lô được lưu trong một transaction; nếu có bản trùng, không lưu dở dang một phần.

Khóa nhận diện là **mã tiêu chuẩn + khối lớp** lấy từ nội dung sheet. Các chuyên ngành được giữ riêng. Cập nhật từ Excel yêu cầu cùng mã, khối lớp và khóa tuyển sinh. Tệp gốc, sheet, người thao tác và lịch sử phiên bản được giữ lại; không ghi đè lịch sử.

## Dữ liệu được ánh xạ

- Ngưỡng tín chỉ tích lũy, tín chỉ bắt buộc, tín chỉ nhóm tự chọn, tín chỉ tự chọn tự do và điểm trung bình tích lũy tối thiểu.
- Từng nhóm bắt buộc/tự chọn với ngưỡng tín chỉ riêng; hai nhóm cùng nhãn `TC102` vẫn có định danh riêng theo dòng nguồn.
- Mã, tên, tín chỉ và cờ môn điều kiện của từng môn. Mã môn K26 như `DIT0010` được giữ nguyên.
- Môn có dấu `(*)` mang cờ `conditionOnly`: không tính tín chỉ tích lũy/GPA theo ghi chú biểu mẫu. Tín chỉ của môn vẫn được giữ, vì nhóm điều kiện có thể yêu cầu đủ số tín chỉ riêng.
- Tín chỉ trống (ví dụ một số môn quốc phòng K27) được lưu `null`, không biến thành 0. Điểm trung bình giữ đúng ngưỡng trong nguồn, không tự suy diễn thang điểm.
- Quản trị viên chọn **Thang điểm trung bình: Hệ 4/Hệ 10** trong form sửa thông tin tiêu chuẩn, cùng ngưỡng điểm tối thiểu. Hệ 4 không nhận ngưỡng lớn hơn 4. Import chỉ nhận thang điểm khi nhãn nguồn ghi rõ; các tiêu chuẩn cũ chưa có thang điểm cần được quản trị viên bổ sung, không tự gán từ giá trị ngưỡng. Thang điểm lưu trong JSON phiên bản và hiển thị ở cổng sinh viên, không cần đổi schema database.
- Bỏ qua cột “đã pass”, dấu đánh dấu và kết quả tính cá nhân ở bên phải. File K26 có tên người học vẫn chỉ cung cấp bộ tiêu chuẩn; không import kết quả của người đó vào hồ sơ sinh viên.

Nội dung ghi chú được giữ làm văn bản. Tệp tải xuống là Excel/ZIP nguồn, chưa bao gồm chỉnh sửa trực tiếp sau import.

## Điểm và đối chiếu của sinh viên

Tại `/dashboard#graduation`, bảng nhóm học phần có cột **Điểm**, hiển thị hệ 10, hệ 4 và điểm chữ đã có trong bảng điểm. Khi học lại, ưu tiên điểm cao nhất trong các lần đạt; nếu chưa đạt thì hiển thị điểm đã có. Điểm 0 được giữ; MT hiển thị miễn thi và không gán điểm số.

Điểm trung bình được kiểm tra riêng theo ngưỡng và thang điểm của tiêu chuẩn. Ưu tiên dòng **điểm trung bình tích lũy** đúng thang trong học kỳ có điểm gần nhất, không dùng điểm trung bình học kỳ hay bản tích lũy cũ. Nếu không có dòng tổng hợp đúng thang, tính **tham khảo** bằng điểm nhân tín chỉ, lấy điểm cao nhất mỗi mã một lần; bỏ môn (*) và MT, không đổi hệ 4 thành hệ 10 hoặc ngược lại. Thiếu điểm/tín chỉ cần thiết, thiếu ngưỡng/thang điểm hoặc dữ liệu tổng hợp không rõ sẽ báo chưa đủ dữ liệu.

Khi các nhóm học phần đã hoàn thành nhưng điểm trung bình dưới ngưỡng, kết quả vẫn **Chưa đạt** và hiện nhắc đăng ký học cải thiện/bổ sung theo quy định của trường. Các môn đã đạt nhưng điểm dưới ngưỡng trung bình được đánh dấu để cân nhắc cải thiện; đây không phải ngưỡng đậu riêng của từng môn. Tiêu chuẩn khác khóa không đưa ra nhắc cải thiện cho sinh viên. Kết quả là đối chiếu tham khảo, không thay kết luận tốt nghiệp của trường.

## Cập nhật và trạng thái

**Sửa thông tin** chỉnh tên, ngưỡng và ghi chú. **Sửa nhóm** chỉnh tên, loại nhóm và tín chỉ yêu cầu. **Sửa môn** chỉnh mã, tên, tín chỉ, chuyển nhóm và cờ môn điều kiện. Mỗi lần lưu tạo phiên bản mới và kiểm tra token để chặn ghi đè thay đổi đồng thời. Các bản lịch sử chỉ đọc.

**Khóa tiêu chuẩn** đánh dấu ngừng áp dụng; quản trị vẫn có thể tìm bằng bộ lọc Đã khóa và mở lại. Không xóa dữ liệu/lịch sử. Những chức năng xét tốt nghiệp tự động sau này phải lọc tiêu chuẩn đang mở và lưu phiên bản tiêu chuẩn đã sử dụng.

## Triển khai và dữ liệu

Migration `013_graduation_standards.sql` thêm bảng tiêu chuẩn, phiên bản JSON, các môn điều kiện và nhật ký. Migration dùng cơ chế hiện có (`DATABASE_AUTO_MIGRATE=true`), bật RLS và thu hồi quyền truy cập trực tiếp của các role API Supabase. Backend tiếp tục kết nối PostgreSQL bằng cấu hình hiện tại. Không có thao tác seed tự động khi khởi động; local/Render không tự đồng bộ dữ liệu nếu dùng hai database riêng.

Bộ đọc Excel dùng [SheetJS CE từ nguồn phân phối chính thức](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/) để hỗ trợ cả XLS cũ và XLSX; chạy trong worker có giới hạn bộ nhớ/thời gian. ZIP và XLSX có giới hạn kích thước giải nén, số file/sheet/dòng. File nguồn thực của người dùng không được đưa vào GitHub.

## Kiểm tra lại

`npm run build` biên dịch API và web. Test `apps/api/src/graduation/parser.test.ts` luôn chạy các trường hợp dữ liệu giả lập; phần đối chiếu 9 file thật chỉ chạy khi có thư mục `output/graduation-audit/files` hoặc biến `GRADUATION_AUDIT_DIR` trỏ đến thư mục chứa các workbook nguồn. Thiếu nguồn riêng tư thì phần đối chiếu được bỏ qua.

Sau build, `node scripts/verify-graduation.mjs` kiểm tra luồng API trên schema tạm. Script yêu cầu `apps/api/.env` trỏ đến PostgreSQL localhost và các bản sao workbook trong `output/graduation-audit/files`; không chạy với Supabase/Render. Schema thử nghiệm được dọn trong `finally`. Thêm `--ui` để giữ máy chủ fixture phục vụ kiểm tra giao diện, kết thúc bằng Ctrl+C để dọn schema.

# Import bảng điểm với worker trên máy cá nhân

Web và Node API tiếp tục chạy trên Render. PDF được giữ trong PostgreSQL/Supabase dưới dạng tác vụ. Worker Python trên máy cá nhân chủ động lấy file qua HTTPS, đọc lớp chữ bằng PyMuPDF trước; chỉ trang không có lớp chữ sử dụng PaddleOCR F3. `html.parser` chỉ phân tích HTML trong nhánh trích xuất HTML, không trực tiếp đọc PDF.

Phạm vi: PDF rõ, xuất/lưu từ cổng đào tạo VLU; tối đa 5 MB, 20 trang, 1.000 môn. Không cam kết hỗ trợ ảnh chụp hoặc scan khác mẫu. PDF có chữ cũng đi qua worker để dùng cùng pipeline đọc biểu tượng kết quả.

## Thiết lập trên máy này

Tại thư mục repository:

```powershell
# Chạy với backend local
node scripts/setup-ocr-worker.mjs

# Hoặc kết nối backend Render
node scripts/setup-ocr-worker.mjs https://edupath-ai-q28n.onrender.com

powershell -ExecutionPolicy Bypass -File services/ocr/start-worker.ps1
```

Script tạo/giữ `OCR_WORKER_KEY` trong `apps/api/.env`, đồng bộ vào `services/ocr/.env`. Không in khóa ra terminal, không commit `.env`.

Trong Render → Environment, thêm **OCR_WORKER_KEY**, sao chép đúng giá trị từ `services/ocr/.env`, sau đó Save / Deploy. Không dán khóa vào frontend hoặc chat. `DATABASE_AUTO_MIGRATE=true` sẽ áp dụng migration `010_transcript_jobs.sql` lúc khởi động. Giữ nguyên DATABASE_URL Supabase đang sử dụng.

Khởi động worker trên máy cá nhân:

```powershell
powershell -ExecutionPolicy Bypass -File services/ocr/start-worker.ps1
```

Script dùng Python đã cài tại `D:\EduPathOCR\.venv\Scripts\python.exe`. Để dùng môi trường khác:

```powershell
powershell -ExecutionPolicy Bypass -File services/ocr/start-worker.ps1 -Python C:\path\to\python.exe
```

Máy khác cần Python tương thích và cài `services/ocr/requirements.txt` trong venv riêng. Model F3 được đóng gói tại `services/ocr/models/f3`. Detector mobile tải từ nguồn PaddleOCR lần đầu nếu chưa có cache; nên chạy một PDF trước buổi demo. Không cần chạy FastAPI/uvicorn, mở cổng router hoặc cài tunnel.

Giữ cửa sổ worker và mạng hoạt động. Ctrl+C dừng worker. Website vẫn hoạt động khi máy tắt, nhưng các PDF mới sẽ chờ. Đổi cấu hình `.env` cần khởi động lại worker; thêm khóa cho backend local cần khởi động lại `npm run dev`.

## Trạng thái và bảo toàn dữ liệu

- Upload trả 202 và mã tác vụ; trang tự lấy trạng thái, có thể rời trang rồi quay lại.
- Mỗi tài khoản có tối đa một tác vụ đang chờ/xử lý, toàn hàng đợi tối đa 25 tác vụ.
- Worker nhận lease 10 phút; xử lý mỗi PDF trong tiến trình riêng, timeout 5 phút. Lease hết hạn cho phép nhận lại một lần; phản hồi mang lease cũ bị từ chối.
- Tác vụ chờ quá 24 giờ thất bại; PDF tạm được xóa khỏi tác vụ khi hoàn tất/thất bại/hủy. Lịch sử trạng thái giữ 7 ngày. Dọn dẹp diễn ra khi trang lấy trạng thái hoặc worker lấy tác vụ.
- Bảng điểm cũ chỉ được thay sau khi JSON hợp lệ. Backend kiểm tra chủ tài khoản, trạng thái hoạt động, version và lease trong transaction. Hủy/xóa/cập nhật khác phiên ngăn kết quả cũ ghi đè.
- Điểm không đọc được, dòng bị bỏ sót hoặc dữ liệu không hợp lệ không được tự đoán và lưu.
- JSONB giữ `sections` tương thích web hiện tại, cảnh báo OCR và `ocr.semesters` có cấu trúc; giao diện tổng kết chuyên biệt có thể nâng cấp sau.

Worker API sử dụng khóa riêng, không cần cookie sinh viên hay truy cập database. Không chia sẻ khóa này: worker có quyền nhận file đang chờ và trả kết quả xử lý. Các bảng tác vụ bật RLS và thu hồi quyền Data API.

## Endpoints

| Endpoint | Quyền / chức năng |
| --- | --- |
| POST /api/student/transcript | Session + Origin; nhận PDF, xếp hàng khi có OCR_WORKER_KEY |
| GET /api/student/transcript | Chỉ bảng điểm/tác vụ của tài khoản hiện tại và trạng thái worker |
| DELETE /api/student/transcript/job | Session + Origin; `{id}` để hủy tác vụ của chính mình |
| POST /api/worker/transcripts/claim | Bearer OCR_WORKER_KEY; lấy một PDF và lease |
| POST /api/worker/transcripts/heartbeat | Bearer key; báo đang kết nối |
| POST /api/worker/transcripts/:id/complete | Bearer key + lease; gửi JSON kết quả hoặc mã lỗi |

Không đặt OCR_WORKER_KEY sẽ giữ parser native cũ cho các triển khai chưa cấu hình worker. Tuy nhiên OCR cần worker và khóa được bật ở cả hai phía.

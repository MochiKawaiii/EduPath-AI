# Worker AI (Ollama + Gemma 4 E4B)

Worker này chạy trên máy cá nhân có GPU. Nó lấy job AI từ API EduPath, gọi Ollama ở chính máy này, rồi gửi kết quả về API. Có ba loại job: nhận xét năng lực cho sinh viên (`competency_assessment`, xem `docs/competency-assessment.md`), đề xuất kỹ năng cho vị trí nghề nghiệp ở trang quản trị (`career_skill_suggestion`, xem `docs/career-ai-suggestions.md`) và lời khuyên điều kiện xét tốt nghiệp cho sinh viên, tạo tự động khi sinh viên import bảng điểm hoặc mở trang Điều kiện xét tốt nghiệp (`graduation_advice`, xem `docs/graduation-advice.md`). Dữ liệu chỉ đi giữa API và máy chạy worker; Ollama chỉ nghe trên `127.0.0.1`.

Mã nguồn nằm ở `apps/api/src/ai-worker/`. Cấu hình nằm ở `services/ai/.env` (không commit).

## 1. Cài Ollama và model (Windows)

1. Cài Ollama bản 0.40.x trở lên:
   ```powershell
   winget install --id Ollama.Ollama -e
   ```
2. Đặt biến môi trường người dùng, rồi thoát hẳn Ollama (biểu tượng ở khay hệ thống) và mở lại:
   ```powershell
   setx OLLAMA_NO_CLOUD 1
   setx OLLAMA_KEEP_ALIVE 15m
   ```
   Không đặt `OLLAMA_HOST=0.0.0.0`. Worker từ chối mọi `OLLAMA_URL` không phải loopback.
3. Tải model (khoảng 6,6 GB):
   ```powershell
   ollama pull gemma4:e4b
   ```
   Không dùng bản `google/gemma-4-E4B` trên Hugging Face: đó là bản gốc chưa tinh chỉnh hội thoại. Worker cũng từ chối tên model có chữ `cloud`.

## 2. Tạo cấu hình

Chạy ở thư mục gốc repo:

```powershell
node scripts/setup-ai-worker.mjs --num-gpu=38
```

Script này:
- tạo `AI_WORKER_KEY` trong `apps/api/.env` nếu chưa có (khóa khác `OCR_WORKER_KEY`, không in ra màn hình);
- ghi lại toàn bộ `services/ai/.env` chỉ với các khóa được phép, thay thế file cũ nếu có.

Khi API chạy trên server (production), truyền địa chỉ HTTPS của API và đặt cùng giá trị `AI_WORKER_KEY` trong biến môi trường của server:

```powershell
node scripts/setup-ai-worker.mjs https://<địa-chỉ-api> --num-gpu=38
```

Nếu script vừa tạo khóa mới, khởi động lại backend để nó đọc khóa.

| Khóa | Ý nghĩa | Mặc định |
|---|---|---|
| `AI_API_URL` | Địa chỉ API (HTTPS, hoặc `http://localhost` / `http://127.0.0.1`) | `http://localhost:4000` |
| `AI_WORKER_KEY` | Khóa xác thực worker, trùng với `apps/api/.env` | (bắt buộc, ≥ 32 ký tự) |
| `OLLAMA_URL` | Địa chỉ Ollama, chỉ loopback | `http://127.0.0.1:11434` |
| `OLLAMA_MODEL` | Tên model | `gemma4:e4b` |
| `OLLAMA_CONTEXT` | `num_ctx` dùng khi khởi động model | `16384` |
| `OLLAMA_NUM_GPU` | Số lớp model đặt trên GPU (tùy chọn) | Ollama tự chọn |
| `AI_TIMEOUT_MS` | Thời gian tối đa cho một lần sinh | `600000` (10 phút) |

## 3. Chạy worker

```powershell
powershell -ExecutionPolicy Bypass -File services/ai/start-worker.ps1
```

hoặc:

```powershell
npm run ai-worker --workspace @edupath/api
```

Worker ghi log dạng JSON, mỗi dòng một sự kiện (`job_claimed`, `generation_finished`, `job_finished`...). Log chỉ chứa mã job, loại job (`kind`), mã lỗi và số liệu thời gian; không bao giờ ghi prompt hay nội dung nhận xét. Nhấn `Ctrl+C` để dừng; job đang chạy dở sẽ được API giao lại sau khi hết hạn lease (15 phút).

**Sau mỗi lần cập nhật mã nguồn, khởi động lại worker** (`Ctrl+C` rồi chạy lại). Worker chỉ báo cho API những loại job có trong mã nguồn lúc nó khởi động. Worker chạy từ bản cũ vẫn làm nhận xét năng lực bình thường, nhưng:
- bản trước lời khuyên tốt nghiệp không báo `graduation_advice`: lời khuyên nằm chờ trong hàng đợi và trang Điều kiện xét tốt nghiệp của sinh viên hiện trạng thái "Máy AI đang chạy phiên bản cũ…" (API trả `worker.supportsAdvice: false`) cho tới khi worker được khởi động lại;
- bản trước đề xuất kỹ năng không báo `career_skill_suggestion`: trang Quản lý nghề nghiệp báo worker chưa hỗ trợ và job đề xuất nằm chờ.

Khởi động lại là đủ, không cần đổi `services/ai/.env`.

Cách worker làm việc:
- Khi khởi động, nạp model một lần với đúng `num_ctx` và `num_gpu` như job thật để job đầu không phải nạp lại.
- Gửi heartbeat mỗi 20 giây khi Ollama sẵn sàng; trang của sinh viên dựa vào đó để báo "worker đang hoạt động".
- Khi rảnh, hỏi job mới mỗi 5 giây; gặp lỗi mạng thì chờ 15 giây. Worker báo cho API các loại job nó làm được; API giao job theo thứ tự đề xuất kỹ năng (admin đang chờ trên trang) → lời khuyên tốt nghiệp (sinh viên có thể đang mở trang) → nhận xét năng lực.
- Trong lúc sinh, gia hạn lease khoảng 3 phút một lần.
- Nếu model trả về JSON hỏng, thử lại đúng 1 lần. Không thử lại khi bị cắt do hết `num_predict` (`ai_output_truncated`) hoặc quá thời gian (`ai_timeout`).

## 4. Tốc độ đo được (RTX 3050 Laptop 4 GB, RAM 16 GB, Ollama 0.40.2)

Prompt tổng hợp khoảng 5.750 token (bảng markdown tiếng Việt giống dữ liệu thật), đầu ra JSON theo schema, `num_ctx` 16384, `num_predict` 4096, `temperature` 0,4. Mỗi lần đo model được nạp lại từ đầu; đầu ra khoảng 1.900–2.500 token.

| `OLLAMA_NUM_GPU` | Sinh (token/giây) | Đọc prompt (token/giây) | Tổng thời gian | VRAM cao nhất |
|---|---|---|---|---|
| không đặt (Ollama tự chọn) | 12,4 | 845 | 225 giây | 2,8 GB |
| 34 | 36,7 | 1.264 | 81 giây | 3,0 GB |
| 38 (đo 2 lần) | 43,7–47,1 | 1.265–1.361 | 74 giây (lần nạp lại sau lỗi: 188 giây) | 3,3 GB |
| 40 | 48,8 | 1.404 | 70 giây | 3,4 GB |
| 42 | không nạp được (thiếu VRAM) | | | |

Khi chạy thật với `OLLAMA_NUM_GPU=38` và model đã được nạp sẵn lúc khởi động, một job nhận xét năng lực mất khoảng 46 giây.

Lời khuyên xét tốt nghiệp ngắn hơn nhiều: trên cùng laptop, với model đã được nạp sẵn, 8 lần chạy thật `gemma4:e4b` trên hai hồ sơ sinh viên tổng hợp đều qua kiểm tra phía server, không mục nào bị loại; mỗi job mất 13–16 giây, khoảng 1.800 token vào và 580–760 token ra (`num_predict` 2048). Đề xuất kỹ năng nghề nghiệp mất khoảng 25–40 giây mỗi vị trí (xem `docs/career-ai-suggestions.md`).

Khuyến nghị: `OLLAMA_NUM_GPU=38`. Mức 40 nhanh hơn khoảng 5% nhưng chỉ còn khoảng 650 MB VRAM dự phòng; 42 không chạy được. Giữ cố định giá trị đã chọn, vì đổi giá trị sẽ khiến Ollama nạp lại model. Nếu VRAM bị chương trình khác chiếm (trình duyệt dùng GPU, OCR...) và Ollama báo lỗi bộ nhớ, giảm xuống 34. Giữ `AI_TIMEOUT_MS=600000`: đủ cho trường hợp nạp model chậm (đã gặp 135 giây) cộng với chế độ Ollama tự chọn (khoảng 6 phút cho 4.096 token).

## 5. Xử lý sự cố

**Máy ngủ làm worker dừng (Modern Standby).** Laptop Windows 11 dùng Modern Standby: sau vài phút không thao tác, máy vào trạng thái ngủ ngay cả khi đang cắm sạc, và worker lẫn Ollama đều đứng. Khi chạy worker lâu:
- Settings → System → Power & battery → Screen, sleep & hibernate timeouts: đặt "Make my device sleep after" là **Never** khi cắm sạc.
- Hoặc đặt bằng lệnh: `powercfg /change standby-timeout-ac 0` (đặt lại sau bằng `powercfg /change standby-timeout-ac 5`), hoặc dùng PowerToys Awake để giữ máy thức trong lúc chạy.
- Không gập máy: gập máy vẫn làm máy ngủ, trừ khi đã đổi "Lid close action" thành "Do nothing".
- Job đang chạy khi máy ngủ sẽ hết lease và được giao lại (tối đa 2 lần), sau đó báo lỗi `worker_timeout`.

**Chạy cùng worker OCR.** GPU 4 GB không đủ cho cả hai. Khi chạy cả worker OCR và worker AI, đặt `OCR_DEVICE=cpu` trong `services/ocr/.env` để OCR chạy bằng CPU.

**`ollama_unavailable`.** Ollama chưa chạy hoặc chưa có model. Kiểm tra `ollama list` có `gemma4:e4b`, và `http://127.0.0.1:11434/api/version` trả về phiên bản. Worker sẽ không nhận job khi Ollama chưa sẵn sàng.

**Chậm bất thường.** Xem `%LOCALAPPDATA%\Ollama\server.log`: kiểm tra Ollama dùng GPU NVIDIA (không phải iGPU Intel) và số lớp được offload. Chạy `ollama ps` để xem tỉ lệ CPU/GPU. Đóng bớt ứng dụng dùng GPU.

**`ai_output_truncated`.** Model viết quá `num_predict` của job (nhận xét năng lực 4096, đề xuất kỹ năng 3072, lời khuyên tốt nghiệp 2048 token). Bấm "Tạo lại nhận xét" trên trang Đánh giá năng lực hoặc "Thử lại" trên trang Điều kiện xét tốt nghiệp; nếu lặp lại thường xuyên, báo lại để rút gọn prompt.

**`ai_timeout`.** Một lần sinh vượt `AI_TIMEOUT_MS` hoặc 120 giây không có dữ liệu mới. Thường do model chạy hoàn toàn trên CPU; kiểm tra `OLLAMA_NUM_GPU` và VRAM còn trống.

**`401 unauthorized` / `503 worker_disabled`.** `AI_WORKER_KEY` ở `services/ai/.env` khác với backend, hoặc backend chưa có khóa. Chạy lại `node scripts/setup-ai-worker.mjs` rồi khởi động lại backend.

**RAM thấp.** Khi Ollama tự chọn số lớp GPU, RAM trống có thể xuống dưới 400 MB trong lúc sinh. Đặt `OLLAMA_NUM_GPU` để đưa nhiều lớp lên GPU hơn và đóng bớt ứng dụng.

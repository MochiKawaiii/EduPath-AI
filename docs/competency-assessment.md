# Đánh giá năng lực sinh viên và nhận xét AI

Trang `#competency` của cổng sinh viên tính năng lực từ bảng điểm, so với nghề mục tiêu, gợi ý học phần và (nếu bật) kèm nhận xét tiếng Việt do một LLM chạy cục bộ viết.

## Kiến trúc: "Hệ thống AI" lai

| Lớp | Vai trò | Vị trí |
|---|---|---|
| Bộ tính điểm dựa trên tri thức | Trọng số học phần → kỹ năng do Khoa cấu hình (AD-COMP). Mọi con số, mức, khoảng trống, gợi ý đều do lớp này tính, thuần và tất định. | `apps/api/src/competency-assessment/calculate.ts`, `constants.ts`, `course-state.ts`, `plan-progress.ts`, `graduation.ts`, `specialty.ts` |
| Thu thập dữ liệu | Đọc ảnh chụp nhất quán (REPEATABLE READ READ ONLY): hồ sơ, bảng điểm, CTĐT, trọng số, tiêu chuẩn tốt nghiệp, KHĐT, nghề mục tiêu. | `inputs.ts` |
| Lưu trữ và API | Lưu kết quả (tối đa 20 bản/sinh viên), đồng ý, hàng đợi AI. | `repository.ts`, `router.ts`, `ai/queue.ts` |
| LLM cục bộ | `gemma4:e4b` qua Ollama trên máy của Khoa; chỉ diễn giải số liệu đã tính, đầu ra bị ràng buộc bằng JSON schema và kiểm tra lại phía server. | `ai/prompt.ts`, `ai/schema.ts`, `ai/validate.ts`, `ai/worker-router.ts`, `apps/api/src/ai-worker/` |
| Giao diện | Trang `#competency`, hộp thoại đồng ý, trạng thái nhận xét AI. | `apps/web/src/StudentCompetency.tsx`, `student-competency-data.ts` |

### Chức năng → thành phần

| Chức năng | Thành phần |
|---|---|
| Suy ra Đạt/Không đạt từ điểm chữ khi cột kết quả trống (A+…D, MT đạt; F không đạt) | `course-state.ts` (API), `apps/web/src/transcript-results.ts` (4 trang web); bảng ca chung `fixtures/result-cases.json` |
| Điểm, độ phủ, độ tin cậy kỹ năng; điểm nhóm; điểm tổng | `calculate.ts` |
| Khoảng trống so với nghề, mức phù hợp, học phần hỗ trợ, tự học | `calculate.ts` |
| Tiến độ theo KHĐT | `plan-progress.ts` |
| Xét tốt nghiệp (cận dưới/cận trên) | `graduation.ts` (API), `apps/web/src/graduation-assessment.ts`; bảng ca chung `fixtures/graduation-cases.json` |
| Chuyên ngành sinh viên (CNPM/CNDL/TTNT) | migration 028, `PATCH /api/student/profile`, `specialty.ts` |
| Nhận xét AI | `ai/*`, `apps/api/src/ai-worker/*`, `services/ai/` |

## Công thức và ngưỡng (`CALC_VERSION = "comp-calc-v3"`)

> comp-calc-v2: kỹ năng dưới ngưỡng còn học phần **Học cải thiện** không bị liệt kê là "Không còn học phần nào trong CTĐT để học thêm" (chỉ khi không còn học phần học mới lẫn học cải thiện).
>
> comp-calc-v3: "x/y kỹ năng có minh chứng" của mỗi nhóm (`groups[].skillCount`) dùng cùng quy tắc với dòng tổng (`overall.basis.applicableSkills`): bỏ kỹ năng chỉ thuộc môn điều kiện và kỹ năng "Ngoài lựa chọn học phần của bạn" (`not_applicable`), nên tổng các nhóm bằng dòng tổng. Trang web tự đếm lại từ danh sách kỹ năng nên kết quả lưu trước v3 cũng hiển thị đúng.

- `cr` = tín chỉ theo CTĐT, `w` = trọng số kỹ năng trong học phần.
- **Điểm kỹ năng (0–100)** = `10 × Σ(score10 × cr × w) / Σ(cr × w)` trên các học phần có điểm (gồm cả lần F); MT tính là đã học nhưng không vào trung bình.
- **Độ phủ** dùng cùng tập học phần áp dụng A (học phần chung ∪ chuyên ngành đã chọn ∪ mọi học phần đã học); mẫu số tính theo hạn mức tín chỉ của từng nhóm tự chọn.
- **Mức**: ≥85 Thành thạo, ≥70 Khá, ≥50 Cơ bản, <50 Cần củng cố.
- **Độ tin cậy** = min(dải độ phủ 30%/70%, dải minh chứng Σ cr·w 1,0/2,5).
- **Nhóm và tổng**: loại GDTC/GDQP (môn điều kiện); điểm tổng = trung bình các nhóm có dữ liệu.
- **Nghề**: Ưu tiên ≥70, Bắt buộc ≥85; hệ số 1/2. Điểm từng yêu cầu: đạt = 1; dưới ngưỡng = 0,5 × clamp((điểm − 40)/(ngưỡng − 40), 0, 1); chưa học = 0; "Sắp học" và "Chưa đủ dữ liệu" bị loại. Nhãn: ≥0,80 Phù hợp, ≥0,50 Khá phù hợp, còn lại Cần bổ sung nhiều; phần hệ số có dữ liệu < 50% → Chưa đủ dữ liệu.
- Mọi ngưỡng nằm trong `constants.ts`; đổi ngưỡng phải tăng `CALC_VERSION`.

### Chọn phiên bản dữ liệu

- CTĐT: bản đang áp dụng của khóa sinh viên (nhiều bản → `curriculum_ambiguous`).
- Trọng số: revision mới nhất của cùng CTĐT có ít nhất một cấu hình đang áp dụng.
- Tiêu chuẩn tốt nghiệp: theo chuyên ngành; `gpaScale` mặc định 4.
- KHĐT: bản gắn với CTĐT, rồi bản cùng định danh; còn lại → ghi là chưa xác định.
- Mỗi kết quả lưu `meta` (phiên bản bảng điểm, CTĐT, trọng số, `calcVersion`, `promptVersion`). Kết quả không bị xóa theo thời gian; chỉ giữ 20 bản mới nhất mỗi sinh viên.

## Lưu trữ và API

Migration: `028_student_specialty.sql`, `029_student_competency_assessments.sql` (`stu_comp_assessments`, `stu_comp_ai_jobs`, `stu_comp_ai_worker_status`, đều bật RLS), `030_competency_consent.sql` (mục đích đồng ý `competency_assessment`).

API sinh viên `/api/student/competency-assessments` (cần đăng nhập, `Cache-Control: no-store`, kiểm tra Origin khi ghi):

| Lệnh | Kết quả |
|---|---|
| `POST /` + header `X-Consent-Policy-Version` | 201 `{ assessment }`; lỗi `consent_required` (400), `policy_outdated`, `transcript_required`, `cohort_unknown`, `curriculum_unavailable`, `curriculum_ambiguous`, `competency_weights_unavailable`, `transcript_changed` (409), `assessment_too_frequent` (429, 60 giây) |
| `GET /latest` | `{ assessment, aiEnabled, workerOnline, consentVersion }` — `consentVersion` là phiên bản chính sách của đồng ý `competency_assessment` đang hiệu lực của chính sinh viên (null nếu chưa có / đã rút). Trang chỉ bỏ qua hộp thoại đồng ý khi giá trị này bằng phiên bản chính sách hiện tại (không lưu đồng ý theo trình duyệt). |
| `GET /latest/status` | `{ id, aiStatus, aiErrorCode, workerOnline }` |
| `POST /:id/ai` | 202 `{ aiStatus }`; `ai_disabled`, `ai_not_regenerable` (409), `queue_full` (429), `assessment_not_found` (404) |
| `DELETE /:id/ai` | `{ cancelled }` |
| `DELETE /` `{ confirmed: true }` | Xóa mọi kết quả và job AI, rút đồng ý |

Xóa hoặc thay bảng điểm (kể cả qua OCR) xóa toàn bộ kết quả đánh giá của sinh viên trong cùng giao dịch.

## Nhận xét AI

- Server bật hàng đợi khi có `AI_WORKER_KEY` (≥ 32 ký tự, khác `OCR_WORKER_KEY`) trong `apps/api/.env` hoặc trên Render.
- Mỗi sinh viên có tối đa một job đang chờ; bản mới hủy job cũ. Quá 25 job chờ toàn hệ thống → `deferred`.
- Prompt `comp-v2`: system prompt cố định + khối dữ liệu đã làm sạch (bỏ token đặc biệt Gemma, ký tự điều khiển). Schema JSON được dựng riêng cho từng job: enum nhóm; enum **điểm mạnh** (kỹ năng mức Khá trở lên, không dưới ngưỡng nghề) tách khỏi enum **cần cải thiện** (dưới Khá hoặc dưới ngưỡng nghề); mã học phần theo từng kỹ năng khoảng trống. Khối dữ liệu chỉ ghi học phần đã học là "minh chứng" (đang học / sắp học ghi riêng), không gửi chỉ số phù hợp dạng số. Validator từ chối mã học phần trong văn bản không có trong khối dữ liệu (`foreign_course`) và kỹ năng vừa là điểm mạnh vừa cần cải thiện/khoảng trống (`conflicting_skill`); trang web còn thay khóa S…/G… lọt vào văn bản bằng tên.
- Prompt `comp-v3`: khối dữ liệu ghi số **đúng như trang hiển thị** — điểm thang 100 (tổng, nhóm, kỹ năng, ngưỡng và điểm của yêu cầu nghề) là số nguyên làm tròn xuống như `formatScore`, mức thiếu làm tròn lên (tối thiểu 1) như `deficitPoints`, độ phủ là phần trăm nguyên, điểm học phần/tín chỉ/điểm trung bình tích lũy tối đa 2 chữ số thập phân. Validator lấy tập số cho phép từ khối dữ liệu nên "83,92" bị từ chối (`invented_number`). Học kỳ ghi bằng chữ ("học kỳ 3 năm học 2025–2026", từ mã HKyyS: yy = năm bắt đầu % 100, S = học kỳ); nếu mô hình vẫn viết mã của một học kỳ có trong dữ liệu (HK253) thì vẫn chấp nhận, mã bịa (HK271) bị từ chối. Prompt giải thích priority: high = "Cần làm sớm", medium = "Nên làm", low = "Có thể để sau" (nhãn trên trang; tránh trùng với tính chất "Ưu tiên" của yêu cầu nghề).
- Trước khi lưu `ai_output`, server (`ai/key-cleanup.ts`) gỡ khóa S…/G… khỏi văn bản: khóa đứng cạnh chính tên của nó bị bỏ cùng dấu nối ("API (S12)" → "API", "(API - S12)" → "(API)", "S12 - API" → "API"), khóa trong ngoặc ở chỗ khác bị bỏ, khóa trần được thay bằng tên. Trang web chạy cùng quy tắc (`cleanKeyText`) cho các nhận xét lưu trước comp-v3.
- Server kiểm tra lại đầu ra: schema Zod strict, danh sách khóa và mã cho phép, không URL/email/HTML, mọi con số trong văn bản phải có trong khối dữ liệu. Sai → `invalid_ai_output`, không hiển thị.

### Giao thức worker (`/api/worker/competency-assessments`)

Xác thực `Authorization: Bearer <AI_WORKER_KEY>` (SHA-256 + `timingSafeEqual`) trước khi đọc body; body tối đa 512 kB.

- `POST /heartbeat`, `POST /claim` (job cũ nhất, `FOR UPDATE SKIP LOCKED`, lease 15 phút, tối đa 2 lần thử), `POST /:id/extend`, `POST /:id/complete` (idempotent theo lease).
- Dọn dẹp tối đa mỗi 60 giây, chạy cả từ `/claim` của worker lẫn từ API sinh viên (`GET /latest`, `GET /latest/status`, khi xếp job mới) nên vẫn chạy khi worker offline: job đang xử lý hết lease sau lần thử cuối, hoặc job (đang chờ / đang xử lý đã hết lease) quá 24 giờ → `failed` với `worker_timeout` và xóa `ai_input`; xóa job đã kết thúc quá 7 ngày. Không bao giờ xóa kết quả đánh giá.

### Cài đặt máy chạy worker

1. Cài Ollama (đã dùng 0.40.2) và `ollama pull gemma4:e4b`.
2. `node scripts/setup-ai-worker.mjs --num-gpu=38` tạo `services/ai/.env` (dùng lại `AI_WORKER_KEY` của `apps/api/.env`).
3. `npm run ai-worker -w @edupath/api` hoặc `services/ai/start-worker.ps1`. Với production đặt `AI_API_URL=https://<render-host>`.

Chi tiết: `services/ai/README.md`.

## Kết quả đo (RTX 3050 4 GB, Ollama 0.40.2, `gemma4:e4b`)

| Cấu hình | Giải mã | Tổng thời gian (prompt ~5,7K token) |
|---|---|---|
| Ollama tự chia GPU | 12,4 tok/s | 225 s |
| `num_gpu` 34 | 36,7 tok/s | 81 s |
| `num_gpu` 38 (khuyến nghị) | 43,7–47,1 tok/s | 74 s |
| `num_gpu` 40 | 48,8 tok/s | 70 s |
| `num_gpu` 42 | không nạp được (hết VRAM) | — |

Kiểm thử đầu-cuối (`node scripts/verify-competency-assessment.mjs --with-ollama`, dữ liệu tổng hợp, `num_gpu` 38): 2249 token prompt, 1154 token đầu ra, nạp model 14,8 s, tổng 39 s; đầu ra qua kiểm tra server. Đánh giá chất lượng trên 5–10 hồ sơ tổng hợp (giai đoạn 2) sẽ được bổ sung vào mục này.

## Kiểm thử

- Unit: `apps/api/src/competency-assessment/**/*.test.ts`, `apps/api/src/ai-worker/*.test.ts`, `apps/web/src/student-competency-data.test.ts`, `StudentCompetency.test.tsx`; fixture tổng hợp `fixtures/synthetic-k29.ts`.
- Tích hợp trên DB local (schema tạm, tự xóa): `npm run build -w @edupath/api && node scripts/verify-competency-assessment.mjs [--with-ollama]`.

## Giới hạn hiện tại

- Chỉ K29 có trọng số kỹ năng.
- Khoảng 30 kỹ năng nghề chưa có học phần đo (hiện là "Chưa đủ dữ liệu").
- Chưa có yêu cầu nghề nào được đánh dấu "Bắt buộc".
- Lịch sử theo thời gian (STU-COMP-07/STU-GAP-07) chưa làm; kết quả đã lưu nhãn phiên bản để làm sau.

# Tạo liên kết kỹ năng với nghề nghiệp (AI)

Chức năng đi kèm AD-REQ-03 "Tạo liên kết kỹ năng với nghề nghiệp (thủ công)". Trong **Quản lý nghề nghiệp → một vị trí → Yêu cầu và kỹ năng**, admin nhờ LLM cục bộ (`gemma4:e4b` qua Ollama trên máy của Khoa, cùng worker với nhận xét năng lực) đề xuất kỹ năng cho vị trí đó. Admin xem lại danh sách, bỏ chọn hoặc xóa dòng, đổi kỹ năng, sửa **Nội dung yêu cầu** và **Mô tả**, đổi **Bắt buộc/Ưu tiên**, rồi chỉ lưu những dòng giữ lại. Không có gì được lưu nếu admin không bấm lưu; kết quả AI không bao giờ được áp dụng nguyên trạng một cách tự động.

## Thành phần

| Lớp | Vai trò | Vị trí |
|---|---|---|
| Prompt | System prompt tiếng Việt, khối dữ liệu đã làm sạch, JSON schema dựng riêng cho từng job (`CAREER_SUGGESTION_PROMPT_VERSION = "career-skill-v1"`) | `apps/api/src/careers/ai-suggestions/prompt.ts` |
| Kiểm tra đầu ra | Kiểm tra phía server trước khi lưu | `apps/api/src/careers/ai-suggestions/validate.ts` |
| Hàng đợi | Xếp job trong giao dịch của admin; nhận/gia hạn/hoàn tất/hết hạn job cho worker | `apps/api/src/careers/ai-suggestions/jobs.ts` |
| API admin | `/api/admin/careers/requirements/ai-suggestions` | `apps/api/src/careers/ai-suggestions/router.ts` |
| Worker | Dùng chung giao thức `/api/worker/competency-assessments`, phân biệt bằng loại job | `apps/api/src/competency-assessment/ai/worker-router.ts`, `worker-protocol.ts`, `apps/api/src/ai-worker/` |
| Giao diện | Mục AI trong panel "Yêu cầu và kỹ năng" của trang Quản lý nghề nghiệp | `apps/web/src/` (cạnh `CareerRequirementsManagement.tsx`) |

## Dữ liệu gửi cho mô hình

Chỉ dữ liệu danh mục nghề nghiệp, không có dữ liệu sinh viên hay dữ liệu cá nhân nên không cần đồng ý:

1. Vị trí: mã, tên tiếng Việt, tên tiếng Anh, lĩnh vực (tên và mô tả), mô tả vị trí, tiêu đề các yêu cầu khác không gắn kỹ năng (tối đa 20).
2. Kỹ năng đã liên kết với vị trí (tên + Bắt buộc/Ưu tiên): chỉ làm ngữ cảnh, không được chọn lại.
3. Danh mục kỹ năng chưa liên kết, sắp theo tên, dạng `khóa | tên | mô tả` với khóa ngắn `S001`, `S002`…; mô tả cắt còn 120 ký tự; tối đa 300 kỹ năng để vừa `num_ctx`.

Mọi chuỗi đi qua `sanitizeText` (dùng chung với nhận xét năng lực): bỏ ký tự điều khiển, token đặc biệt của Gemma (`<|turn>`, `<eos>`…), đổi `"` thành `'`, giới hạn độ dài. Bảng khóa → mã kỹ năng (`catalog`) và danh sách kỹ năng đã liên kết (`linked`) chỉ nằm trong `ai_input` trên server, không gửi cho worker.

## Quy tắc trong prompt

- Vai trò: chuyên gia tư vấn nghề nghiệp ngành CNTT, hỗ trợ Khoa Công nghệ Thông tin, Trường Đại học Văn Lang xây dựng yêu cầu kỹ năng cho vị trí nghề nghiệp.
- Chỉ chọn khóa trong danh mục; không chọn kỹ năng đã liên kết.
- 6–12 kỹ năng dùng trực tiếp trong công việc hằng ngày; thiếu kỹ năng phù hợp thì chọn ít hơn, không chọn cho đủ số.
- Bỏ qua kỹ năng giáo dục đại cương (thể chất, quốc phòng - an ninh, chính trị, pháp luật cơ bản, cờ vua…) trừ khi công việc thật sự cần. Danh mục local hiện có các kỹ năng như "Rèn luyện thể chất", "Vận dụng luật và chiến thuật cờ vua".
- Nhiều kỹ năng gần giống nhau thì chỉ chọn một kỹ năng sát nhất.
- **Bắt buộc** (`required`) chỉ cho kỹ năng cốt lõi, thiếu thì không làm được công việc chính, thường 2–5 kỹ năng; còn lại là **Ưu tiên** (`preferred`). Trong đánh giá năng lực, Bắt buộc là ngưỡng 85 và Ưu tiên là 70, nên đánh dấu Bắt buộc quá nhiều sẽ làm mức phù hợp nghề của sinh viên thấp đi.
- `title` (Nội dung yêu cầu): một câu ngắn bắt đầu bằng động từ, tối đa 120 ký tự, ví dụ "Viết truy vấn SQL để trích xuất và tổng hợp dữ liệu".
- `description` (Mô tả): 1–2 câu về cách vị trí dùng kỹ năng, tối đa 400 ký tự.
- `reason` (Lý do đề xuất): gắn với mô tả vị trí, tối đa 200 ký tự; chỉ hiển thị cho admin, không lưu vào yêu cầu.
- `newSkills`: chỉ cho kỹ năng thiết yếu mà danh mục rõ ràng chưa có, tối đa 3, tên ngắn, không phải từ đồng nghĩa của kỹ năng có sẵn.
- Không viết khóa hay mã trong văn bản; không đường link, tên khóa học, chứng chỉ, tên công ty, mức lương, hứa hẹn việc làm (được nêu tên công cụ, công nghệ khi vị trí thật sự dùng); tiếng Việt có dấu, văn bản thuần.

Tùy chọn Ollama: `{ num_ctx: 16384, num_predict: 3072, temperature: 0.3, top_p: 0.95, top_k: 64 }` (worker thêm `think: false`, `stream`, `format` = schema).

## Cấu trúc đầu ra

```json
{
  "suggestions": [
    { "skillKey": "S012", "priority": "required", "title": "…", "description": "…", "reason": "…" }
  ],
  "newSkills": [
    { "name": "…", "priority": "preferred", "title": "…", "description": "…", "reason": "…" }
  ]
}
```

`skillKey` là enum gồm đúng các khóa của job (kỹ năng chưa liên kết); `suggestions` tối đa 12 mục, `newSkills` tối đa 3. Grammar cho phép `title` 160, `description` 600, `reason` 300 ký tự để câu hơi dài vẫn được cắt gọn thay vì làm hỏng cả job.

## Kiểm tra phía server

Chặt về cấu trúc, mềm với từng mục (admin còn duyệt từng dòng trước khi lưu):

1. Zod strict theo cấu trúc trên; JSON hỏng hoặc sai cấu trúc → job `failed` với `invalid_ai_output`.
2. Bỏ khóa không có trong job hoặc lặp lại.
3. Khóa lọt vào văn bản được thay bằng tên kỹ năng (`cleanKeyText`, cùng quy tắc với nhận xét năng lực: "SQL (S002)" → "SQL"); bỏ token điều khiển; cắt độ dài (160/600/300 ký tự, tên kỹ năng mới 100).
4. Bỏ mục có đường link, email hoặc HTML (`hasForbiddenContent`).
5. Kỹ năng mới có tên trùng (so sánh không dấu, không phân biệt hoa thường bằng `fold()`) với kỹ năng trong danh mục được đổi thành kỹ năng đó; bị bỏ nếu kỹ năng đó đã được đề xuất hoặc đã liên kết. Tên mới trùng nhau chỉ giữ một.
6. Mô hình trả về mục nhưng không mục nào hợp lệ → `failed` với `invalid_ai_output`; mô hình không trả về mục nào → `completed` với danh sách rỗng.

Kết quả lưu ở `career_ai_suggestions.result = { items, returned, dropped }`; mỗi mục có `skillId` (null nếu là kỹ năng mới), `skillName`, `isNewSkill`, `isRequired`, `title`, `description`, `reason`. Cùng lúc lưu `ai_model`, `ai_model_digest`, `ollama_version`, `prompt_version`, `metrics`, `completed_at` và xóa `ai_input`.

## API admin

Đăng nhập cổng quản trị, cùng quy tắc vai trò và Origin với các route `/api/admin/careers` khác (ghi trong giao dịch, kiểm tra lại vai trò bằng `access(client, user, true, false, true)`). Chỉ có ở router nghề nghiệp của admin, không có ở API sinh viên. Body sai → 400 `invalid_ai_suggestion`.

| Lệnh | Kết quả |
|---|---|
| `GET /status` | `{ enabled, worker: { online, supportsSuggestions, seenAt } }`. `enabled` = server có `AI_WORKER_KEY`; `online` = heartbeat trong 60 giây; `supportsSuggestions` = online và worker báo hỗ trợ `career_skill_suggestion`. |
| `GET /latest?careerPositionId=` | `{ suggestion }`: bản mới nhất của vị trí trong 7 ngày, chưa hủy, chưa áp dụng; không có thì `null`. |
| `POST /` `{ careerPositionId }` | 201 `{ suggestion }` (đang chờ); vị trí đã có job đang chờ/đang xử lý → 200 với job đó. Lỗi: 503 `ai_disabled`, 404 `career_not_found`, 429 `ai_queue_full` (từ 10 job đang chờ/đang xử lý trên toàn hệ thống). |
| `GET /:id` | `{ suggestion }`; 404 `suggestion_not_found`. |
| `POST /:id/cancel` `{}` | `{ suggestion }`; chỉ khi đang chờ/đang xử lý, nếu không 409 `suggestion_not_active`. |
| `POST /:id/apply` `{ items }` | 201 `{ created, suggestion }`. Xem bên dưới. |

`suggestion` có dạng `{ id, careerPositionId, status, errorCode, createdAt, updatedAt, completedAt, appliedAt, model, promptVersion, items }`. `items` rỗng trừ khi `completed`; mỗi mục có `index` (vị trí trong kết quả đã lưu), `skillId`, `skillName` (tên hiện tại trong danh mục hoặc tên mới đề xuất), `isNewSkill`, `alreadyLinked` (tính lúc đọc), `isRequired`, `title`, `description`, `reason`. Mục trỏ tới kỹ năng đã bị xóa khỏi danh mục sau khi đề xuất thì không trả về nữa (các `index` còn lại giữ nguyên).

`errorCode`: `ai_timeout`, `ai_output_truncated`, `invalid_ai_output`, `ollama_unavailable`, `ai_failed`, `worker_timeout`.

**Áp dụng** (`POST /:id/apply`): `items` gồm 1–20 dòng `{ skillId, skillName, title, description, isRequired, sourceIndex }` (`skillId` null thì cần `skillName` ≤ 100 ký tự; `title` 1–160; `description` ≤ 4000; `sourceIndex` là `index` của mục AI gốc, null nếu admin tự thêm dòng). Chỉ áp dụng được khi `completed` và chưa áp dụng (409 `suggestion_not_completed` / `suggestion_already_applied`). Tất cả dòng được tạo trong **một** giao dịch với cùng khóa và quy tắc như thêm thủ công (`lockSkillCatalog`, khóa vị trí, `skillFor`); tên kỹ năng mới được tạo trong danh mục như tùy chọn "Thêm kỹ năng mới…", nhưng nếu tên trùng không dấu với kỹ năng có sẵn thì dùng kỹ năng đó. Sau đó làm mới danh sách kỹ năng của vị trí. Trùng lặp (kỹ năng đã liên kết, hoặc cùng kỹ năng hai lần trong `items`) → 409 `{ error: "requirement_exists", skills: [...] }` và không lưu gì; va chạm chỉ mục duy nhất do ghi đồng thời cũng trả 409 `requirement_exists`.

## Giao thức worker và loại job

Cùng đường dẫn `/api/worker/competency-assessments`, cùng khóa `AI_WORKER_KEY`, lease 15 phút, tối đa 2 lần thử, cùng mã lỗi. Loại job: `competency_assessment` (cũ) và `career_skill_suggestion` (mới).

- `POST /heartbeat` và `POST /claim` nhận body tùy chọn `{ kinds?: string[] }`, lưu vào `stu_comp_ai_worker_status.kinds` (bỏ loại không biết; thiếu hoặc rỗng → `['competency_assessment']`). Worker cũ gửi `{}` nên **không bao giờ** nhận job nghề nghiệp.
- `/claim` của worker có `career_skill_suggestion` thử job nghề nghiệp trước (admin đang chờ trên trang, job hiếm), rồi mới tới job nhận xét năng lực. Job trả về có thêm `kind`; các trường khác giữ nguyên (`id`, `leaseToken`, `promptVersion`, `system`, `user`, `schema`, `options`).
- `/:id/extend` và `/:id/complete` tìm id ở cả hai bảng job. Hoàn tất một job đã bị admin hủy → 409 `job_expired`, job vẫn ở trạng thái hủy.
- Dọn dẹp chạy cùng lúc với dọn dẹp của nhận xét năng lực (tối đa mỗi 60 giây, từ `/claim` và từ API admin): job chờ quá 24 giờ, hoặc đang xử lý hết lease sau lần thử cuối → `failed` với `worker_timeout`, xóa `ai_input`. Khác với job nhận xét năng lực, dòng `career_ai_suggestions` không bị xóa theo thời gian vì là bản ghi kiểm toán.
- Worker (`apps/api/src/ai-worker`) gửi `kinds: ["competency_assessment", "career_skill_suggestion"]`, đọc `job.kind` (mặc định `competency_assessment` khi server cũ không gửi), và kiểm tra nhanh theo loại: nhận xét năng lực dùng `parseAiOutput`, đề xuất kỹ năng dùng `parseCareerSuggestionOutput` (đối tượng JSON có mảng `suggestions` và mảng `newSkills`). JSON hỏng thì thử lại đúng 1 lần như cũ. Log chỉ có mã job, loại job, mã lỗi và số liệu.

## Lưu trữ, kiểm toán và số liệu

Migration `031_career_ai_suggestions.sql`: bảng `career_ai_suggestions` (bật RLS, thu hồi quyền của `anon`/`authenticated`/`service_role`), chỉ mục một job đang chờ cho mỗi vị trí, chỉ mục hàng đợi và chỉ mục bản gần nhất; cột `kinds` cho `stu_comp_ai_worker_status`.

Mỗi dòng giữ: người yêu cầu (`requested_by`), trạng thái, số lần thử, kết quả đã kiểm tra, mô hình (`ai_model`, `ai_model_digest`, `ollama_version`, `prompt_version`), `metrics` của Ollama (`prompt_eval_count`, `eval_count`, thời gian), và khi áp dụng: `applied_at`, `applied_by`, `applied_summary = { suggested, saved, edited, newSkills }`:

- `suggested`: số mục AI trong kết quả đã lưu;
- `saved`: số dòng admin lưu;
- `edited`: số dòng đã lưu khác mục AI gốc (`sourceIndex`) ở nội dung yêu cầu, mô tả, tính chất hoặc kỹ năng; dòng admin tự thêm cũng tính là đã sửa;
- `newSkills`: số kỹ năng mới được tạo trong danh mục.

Số liệu cho báo cáo: tỉ lệ chấp nhận = `saved / suggested`, tỉ lệ chỉnh sửa = `edited / saved`, tỉ lệ job lỗi theo `error_code`, thời gian sinh theo `metrics`. Ví dụ:

```sql
SELECT count(*) AS applied,
  sum((applied_summary->>'saved')::int)::float / nullif(sum((applied_summary->>'suggested')::int), 0) AS acceptance,
  sum((applied_summary->>'edited')::int)::float / nullif(sum((applied_summary->>'saved')::int), 0) AS edit_rate
FROM career_ai_suggestions WHERE applied_at IS NOT NULL AND prompt_version = 'career-skill-v1';
```

## Chạy ở máy local

1. Backend có `AI_WORKER_KEY` trong `apps/api/.env` (tạo bằng `node scripts/setup-ai-worker.mjs`, xem `services/ai/README.md`). Dev server tự áp dụng migration 031 khi khởi động lại.
2. Chạy worker: `npm run ai-worker -w @edupath/api` hoặc `services/ai/start-worker.ps1`.
3. **Sau khi cập nhật mã nguồn, khởi động lại worker một lần.** Worker đang chạy từ trước vẫn làm job nhận xét năng lực bình thường nhưng không báo hỗ trợ `career_skill_suggestion`, nên trang hiển thị worker chưa hỗ trợ đề xuất kỹ năng và job nghề nghiệp nằm chờ cho tới khi worker mới nhận.
4. Mở **Quản lý nghề nghiệp → một vị trí → Yêu cầu và kỹ năng** và yêu cầu AI đề xuất. Với danh mục local hiện tại (khoảng 130 kỹ năng chưa liên kết cho một vị trí), khối dữ liệu dài khoảng 10.000 ký tự, ngắn hơn prompt nhận xét năng lực; thời gian sinh thực tế chưa đo.

## Kiểm thử

- Unit: `apps/api/src/careers/ai-suggestions/*.test.ts` (prompt, kiểm tra đầu ra, API admin với pool giả), `apps/api/src/competency-assessment/ai/worker-router.test.ts` (loại job, worker cũ không nhận job nghề nghiệp, gia hạn/hoàn tất/hủy), `apps/api/src/ai-worker/*.test.ts`.
- Chưa đo chất lượng đề xuất với Gemma trên dữ liệu thật; nên chạy thử trên vài vị trí (ví dụ Chuyên viên phân tích dữ liệu, Kỹ sư DevOps) và ghi lại `applied_summary` để đánh giá.

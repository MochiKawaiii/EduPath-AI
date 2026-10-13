# Tạo liên kết kỹ năng với nghề nghiệp (AI)

Chức năng đi kèm AD-REQ-03 "Tạo liên kết kỹ năng với nghề nghiệp (thủ công)". Trong **Quản lý nghề nghiệp → một vị trí → Yêu cầu và kỹ năng**, admin nhờ LLM cục bộ (`gemma4:e4b` qua Ollama trên máy chạy worker AI, hiện là laptop của nhóm thực hiện đồ án, cùng worker với nhận xét năng lực) đề xuất kỹ năng cho vị trí đó. Admin xem lại danh sách, bỏ chọn hoặc xóa dòng, đổi kỹ năng, sửa **Nội dung yêu cầu** và **Mô tả**, đổi **Bắt buộc/Ưu tiên**, rồi chỉ lưu những dòng giữ lại. Không có gì được lưu nếu admin không bấm lưu; kết quả AI không bao giờ được áp dụng nguyên trạng một cách tự động.

## Thành phần

| Lớp | Vai trò | Vị trí |
|---|---|---|
| Prompt | System prompt tiếng Việt, khối dữ liệu đã làm sạch, JSON schema dựng riêng cho từng job (`CAREER_SUGGESTION_PROMPT_VERSION = "career-skill-v2"`) | `apps/api/src/careers/ai-suggestions/prompt.ts` |
| Kiểm tra đầu ra | Kiểm tra và hậu xử lý phía server trước khi lưu | `apps/api/src/careers/ai-suggestions/validate.ts` |
| Gần giống | So sánh tên kỹ năng để đánh dấu đề xuất gần giống kỹ năng đã liên kết | `apps/api/src/careers/ai-suggestions/similarity.ts` |
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

Phiên bản hiện tại là `career-skill-v2`; các dòng cũ trong bảng có thể mang `career-skill-v1` (bản đầu, xem phần Kiểm thử).

- Vai trò: chuyên gia tư vấn nghề nghiệp ngành CNTT, hỗ trợ Khoa Công nghệ Thông tin, Trường Đại học Văn Lang xây dựng yêu cầu kỹ năng cho vị trí nghề nghiệp.
- Trước khi chọn, xác định bộ kỹ năng chuyên môn cốt lõi của công việc (ngôn ngữ lập trình, công cụ, nền tảng, kỹ thuật, phương pháp; ví dụ vị trí làm dữ liệu: ngôn ngữ lập trình, cách lưu trữ và công cụ xử lý dữ liệu) rồi tìm chúng trong danh mục trước.
- Chỉ chọn khóa trong danh mục; không chọn kỹ năng đã liên kết, cũng không chọn kỹ năng trùng, gần nghĩa, hoặc chỉ rộng hơn/hẹp hơn kỹ năng đã liên kết (ví dụ chung trong prompt: đã có "SQL" thì không chọn "Truy vấn dữ liệu bằng SQL"; đã có "Giao tiếp" thì không chọn "Giao tiếp và thuyết trình").
- 6–12 kỹ năng, chủ yếu là kỹ năng chuyên môn trực tiếp làm ra sản phẩm công việc; kỹ năng mềm (giao tiếp, làm việc nhóm, tư duy, tự học…) tối đa 3; thiếu kỹ năng phù hợp thì chọn ít hơn, không chọn cho đủ số.
- Bỏ qua kỹ năng giáo dục đại cương (thể chất, quốc phòng - an ninh, chính trị, pháp luật cơ bản, cờ vua…) trừ khi công việc thật sự cần. Danh mục local hiện có các kỹ năng như "Rèn luyện thể chất", "Vận dụng luật và chiến thuật cờ vua".
- Nhiều kỹ năng gần giống nhau trong danh mục thì chỉ chọn một kỹ năng sát nhất.
- **Bắt buộc** (`required`) chỉ cho kỹ năng cốt lõi, thiếu thì không làm được công việc chính: thường 2–4, tối đa 5, tính cả kỹ năng mới; kỹ năng mềm và kiến thức nền tảng chung (ví dụ kiến thức nền tảng CNTT) luôn là **Ưu tiên** (`preferred`); phân vân thì chọn Ưu tiên. Trong đánh giá năng lực, Bắt buộc là ngưỡng 85 và Ưu tiên là 70, nên đánh dấu Bắt buộc quá nhiều sẽ làm mức phù hợp nghề của sinh viên thấp đi. Server còn tự giới hạn (xem phần Kiểm tra phía server).
- `title` (Nội dung yêu cầu): một câu ngắn bắt đầu bằng động từ, tối đa 120 ký tự, ví dụ "Viết truy vấn SQL để trích xuất và tổng hợp dữ liệu".
- `description` (Mô tả): 1–2 câu về cách vị trí dùng kỹ năng, tối đa 400 ký tự.
- `reason` (Lý do đề xuất): gắn với mô tả vị trí, tối đa 200 ký tự; chỉ hiển thị cho admin, không lưu vào yêu cầu.
- `newSkills`: chỉ cho kỹ năng chuyên môn thiết yếu mà danh mục rõ ràng chưa có, tối đa 3; tên là cụm danh từ ngắn, không mở đầu bằng "Kỹ năng", không gần nghĩa với kỹ năng đã liên kết hay trong danh mục.
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

Hậu xử lý cố định, không phụ thuộc việc mô hình có theo prompt hay không (lần chạy thật với v1 cho thấy mô hình hay bỏ qua các quy tắc mềm này):

7. Tên kỹ năng mới: bỏ tiền tố "Kỹ năng"/"Kĩ năng" ở đầu (mọi kiểu chữ, kể cả không dấu, cùng dấu `:`/`-` theo sau), gộp khoảng trắng, viết hoa chữ đầu nếu là từ thường ("Kỹ năng phân tích nghiệp vụ" → "Phân tích nghiệp vụ"; "Kỹ năng iOS" → "iOS"), rồi mới so trùng ở bước 5. Tên chỉ có tiền tố bị bỏ. (`cleanNewSkillName`)
8. Kỹ năng mới luôn lưu là **Ưu tiên** (`isRequired = false`) vì chưa có học phần nào ánh xạ tới. Tên "mới" trùng kỹ năng trong danh mục được đổi thành kỹ năng đó và giữ tính chất mô hình chọn.
9. Tối đa 5 kỹ năng **Bắt buộc** (`CAREER_SUGGESTION_LIMITS.required`), theo thứ tự mô hình trả về; các mục Bắt buộc sau đó đổi thành Ưu tiên.

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

`suggestion` có dạng `{ id, careerPositionId, status, errorCode, createdAt, updatedAt, completedAt, appliedAt, model, promptVersion, items }`. `items` rỗng trừ khi `completed`; mỗi mục có dạng

```ts
{
  index: number;                     // vị trí trong kết quả đã lưu
  skillId: string | null;            // null = kỹ năng mới
  skillName: string;                 // tên hiện tại trong danh mục hoặc tên mới đề xuất
  isNewSkill: boolean;
  alreadyLinked: boolean;            // tính lúc đọc
  similarLinkedSkill: string | null; // tính lúc đọc, xem bên dưới
  isRequired: boolean;
  title: string;
  description: string;
  reason: string;
}
```

Mục trỏ tới kỹ năng đã bị xóa khỏi danh mục sau khi đề xuất thì không trả về nữa (các `index` còn lại giữ nguyên).

**Gần giống kỹ năng đã liên kết** (`similarLinkedSkill`): tên của kỹ năng đầu tiên (theo thứ tự tên) đang liên kết với vị trí mà tên gần giống tên mục; `null` nếu mục đã liên kết hoặc không có. Danh mục có nhiều cặp gần nghĩa ("Thống kê"/"Phân tích thống kê", "SQL"/"Truy vấn dữ liệu bằng SQL") và prompt chặt hơn cũng không ngăn được mô hình chọn chúng, nên server đánh dấu thay vì loại: đây chỉ là gợi ý mềm, dòng được đánh dấu vẫn hiển thị và vẫn lưu được, nhận nhầm chỉ khiến admin phải tự tích một dòng. Quy tắc (`similarSkillNames` trong `similarity.ts`): viết thường hai tên (giữ dấu), tách token theo ký tự không phải chữ/số (giữ `#` và `+` trong token như C#, C++), bỏ cụm "kỹ năng"/"kĩ năng" và từ dừng `và, với, bằng, cho, của, trong, trên`; hai token bằng nhau khi giống nhau cả dấu thanh nhưng không xét vị trí dấu ("hóa" = "hoá"), còn token viết không dấu thì so không dấu. Không bỏ dấu thanh vì tiếng Việt tách theo âm tiết: bỏ dấu thì "Thống kê" nằm trọn trong "Phân tích và thiết kế hệ thống" (kê/kế, thống). Hai tên gần giống khi tập token (khác rỗng) của tên này nằm trọn trong tên kia, hoặc chỉ số Jaccard ≥ 0,75 (ngưỡng cao vì tên tiếng Việt tách theo âm tiết, các kỹ năng "anh em" dễ chung phần lớn token). Ví dụ gần giống: Giao tiếp / Giao tiếp và thuyết trình, Python / Lập trình Python, Linux / Linux/Windows Server, HTML/CSS / Phát triển giao diện web (HTML/CSS/JavaScript). Không gần giống: Viết tài liệu / Viết báo cáo, Phân tích dữ liệu / Phân tích thống kê, Thống kê / Phân tích và thiết kế hệ thống, Git / GitHub Actions, C# / C++. Với ngưỡng 0,6, danh mục local (134 kỹ năng) có 22 cặp bị đánh dấu, trong đó hai cặp nhận nhầm chỉ do Jaccard (Phát triển ứng dụng Android / Phát triển ứng dụng desktop: 0,67; Xây dựng mô hình học máy / Xây dựng mô hình học sâu: 0,71); với ngưỡng 0,75 còn 20 cặp, tất cả do một tên chứa trọn tên kia (ví dụ SQL / Truy vấn dữ liệu bằng SQL, API / REST API); một cặp vẫn là gợi ý chưa chuẩn (Flutter/React Native / React).

`errorCode`: `ai_timeout`, `ai_output_truncated`, `invalid_ai_output`, `ollama_unavailable`, `ai_failed`, `worker_timeout`.

**Áp dụng** (`POST /:id/apply`): `items` gồm 1–20 dòng `{ skillId, skillName, title, description, isRequired, sourceIndex }` (`skillId` null thì cần `skillName` ≤ 100 ký tự; `title` 1–160; `description` ≤ 4000; `sourceIndex` là `index` của mục AI gốc, null nếu admin tự thêm dòng). Tên kỹ năng mới được cắt khoảng trắng hai đầu và gộp khoảng trắng bên trong trước khi so trùng và tạo kỹ năng, nên "Lập  trình" không tạo ra bản gần trùng của "Lập trình". Chỉ áp dụng được khi `completed` và chưa áp dụng (409 `suggestion_not_completed` / `suggestion_already_applied`). Tất cả dòng được tạo trong **một** giao dịch với cùng khóa và quy tắc như thêm thủ công (`lockSkillCatalog`, khóa vị trí, `skillFor`); tên kỹ năng mới được tạo trong danh mục như tùy chọn "Thêm kỹ năng mới…", nhưng nếu tên trùng không dấu với kỹ năng có sẵn thì dùng kỹ năng đó. Sau đó làm mới danh sách kỹ năng của vị trí. Trùng lặp (kỹ năng đã liên kết, hoặc cùng kỹ năng hai lần trong `items`) → 409 `{ error: "requirement_exists", skills: [...] }` và không lưu gì; va chạm chỉ mục duy nhất do ghi đồng thời cũng trả 409 `requirement_exists`.

## Giao thức worker và loại job

Cùng đường dẫn `/api/worker/competency-assessments`, cùng khóa `AI_WORKER_KEY`, lease 15 phút, tối đa 2 lần thử, cùng mã lỗi. Có ba loại job (`AI_JOB_KINDS` trong `competency-assessment/ai/worker-protocol.ts`): `competency_assessment` (nhận xét năng lực, loại đầu tiên), `career_skill_suggestion` (đề xuất kỹ năng, tài liệu này) và `graduation_advice` (lời khuyên xét tốt nghiệp cho sinh viên, xem `docs/graduation-advice.md`).

- `POST /heartbeat` và `POST /claim` nhận body tùy chọn `{ kinds?: string[] }`, lưu vào `stu_comp_ai_worker_status.kinds` (bỏ loại không biết; thiếu hoặc rỗng → `['competency_assessment']`). Worker cũ gửi `{}` nên **không bao giờ** nhận job nghề nghiệp hay lời khuyên tốt nghiệp; worker phát hành trước lời khuyên tốt nghiệp chỉ báo hai loại đầu nên không nhận `graduation_advice`.
- `/claim` thử theo thứ tự **đề xuất kỹ năng → lời khuyên tốt nghiệp → nhận xét năng lực**, mỗi loại chỉ khi worker có báo loại đó: job nghề nghiệp trước vì admin đang chờ trên trang và job hiếm, rồi lời khuyên tốt nghiệp (sinh viên có thể đang mở trang), cuối cùng là nhận xét năng lực. Job trả về có thêm `kind`; các trường khác giữ nguyên (`id`, `leaseToken`, `promptVersion`, `system`, `user`, `schema`, `options`).
- `/:id/extend` và `/:id/complete` tìm id lần lượt ở bảng job nhận xét năng lực, `career_ai_suggestions` rồi `stu_grad_advice`. Hoàn tất một job đã bị admin hủy → 409 `job_expired`, job vẫn ở trạng thái hủy.
- Dọn dẹp chạy cùng lúc với dọn dẹp của nhận xét năng lực và lời khuyên tốt nghiệp (mỗi loại tối đa mỗi 60 giây; với job nghề nghiệp, chạy từ `/claim` và từ API admin): job chờ quá 24 giờ, hoặc đang xử lý hết lease sau lần thử cuối → `failed` với `worker_timeout`, xóa `ai_input`. Khác với job nhận xét năng lực, dòng `career_ai_suggestions` không bị xóa theo thời gian vì là bản ghi kiểm toán.
- Worker (`apps/api/src/ai-worker`) mặc định gửi cả ba loại `kinds: ["competency_assessment", "career_skill_suggestion", "graduation_advice"]`, đọc `job.kind` (mặc định `competency_assessment` khi server cũ không gửi), và kiểm tra nhanh theo loại: nhận xét năng lực dùng `parseAiOutput`, đề xuất kỹ năng dùng `parseCareerSuggestionOutput` (đối tượng JSON có mảng `suggestions` và mảng `newSkills`), lời khuyên tốt nghiệp dùng `parseGraduationAdviceOutput`. JSON hỏng thì thử lại đúng 1 lần như cũ. Log chỉ có mã job, loại job, mã lỗi và số liệu.

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
FROM career_ai_suggestions WHERE applied_at IS NOT NULL AND prompt_version = 'career-skill-v2';
```

So sánh v1 và v2 bằng cách nhóm theo `prompt_version`.

## Chạy ở máy local

1. Backend có `AI_WORKER_KEY` trong `apps/api/.env` (tạo bằng `node scripts/setup-ai-worker.mjs`, xem `services/ai/README.md`). Dev server tự áp dụng migration 031 khi khởi động lại.
2. Chạy worker: `npm run ai-worker -w @edupath/api` hoặc `services/ai/start-worker.ps1`.
3. **Sau khi cập nhật mã nguồn, khởi động lại worker một lần.** Worker chỉ báo những loại job có trong mã nguồn lúc nó khởi động. Worker chạy từ bản trước đề xuất kỹ năng vẫn làm job nhận xét năng lực bình thường nhưng không báo hỗ trợ `career_skill_suggestion`, nên trang hiển thị worker chưa hỗ trợ đề xuất kỹ năng và job nghề nghiệp nằm chờ cho tới khi worker mới nhận. Tương tự, worker chạy từ bản trước lời khuyên tốt nghiệp không báo `graduation_advice`: lời khuyên nằm chờ và trang Điều kiện xét tốt nghiệp của sinh viên hiện trạng thái "Máy AI đang chạy phiên bản cũ…".
4. Mở **Quản lý nghề nghiệp → một vị trí → Yêu cầu và kỹ năng** và yêu cầu AI đề xuất. Với danh mục local hiện tại (khoảng 130 kỹ năng chưa liên kết cho một vị trí), khối dữ liệu dài khoảng 10.000 ký tự (khoảng 4.000 token vào), ngắn hơn prompt nhận xét năng lực. Đo thực tế với `gemma4:e4b` trên RTX 3050 4 GB (`OLLAMA_NUM_GPU=38`): khoảng 25–40 giây mỗi vị trí từ lúc nhận việc đến lúc hoàn tất, 1.100–1.400 token ra.

## Giao diện

Mỗi đề xuất là một thẻ có thể sửa. Dòng trong danh mục được tích sẵn, trừ khi đã liên kết hoặc có `similarLinkedSkill`; kỹ năng mới luôn bắt đầu chưa tích. Dòng gần giống có nhãn cảnh báo "Gần giống: {tên}" và ghi chú "Nghề này đã có kỹ năng “{tên}”. Chỉ chọn nếu đây là kỹ năng khác."; nhãn và ghi chú biến mất khi admin đổi sang kỹ năng khác hoặc gõ tên khác. Dòng đã liên kết giữ nguyên như cũ (nhãn "Đã liên kết", không sửa được).

## Kiểm thử

- Unit: `apps/api/src/careers/ai-suggestions/*.test.ts` (prompt, kiểm tra và hậu xử lý đầu ra, so sánh gần giống, API admin với pool giả), `apps/api/src/competency-assessment/ai/worker-router.test.ts` (loại job và thứ tự nhận, worker cũ không nhận job nghề nghiệp hay lời khuyên tốt nghiệp, gia hạn/hoàn tất/hủy), `apps/api/src/ai-worker/*.test.ts`, `apps/web/src/career-ai-suggestions.test.ts`, `apps/web/src/CareerSkillAiSuggestions.test.tsx`.
- Tích hợp: `npm run build -w @edupath/api && node scripts/verify-career-ai-suggestions.mjs` chạy toàn bộ luồng trên schema tạm với dữ liệu nghề nghiệp local (thêm `--with-ollama` để gọi Gemma thật cho NN004, NN005, NN003).
- Chạy thật với v1 (Gemma, 3 vị trí, khoảng 30–40 giây và 1,2–1,4 nghìn token đầu ra mỗi vị trí): tiếng Việt tốt, không lộ khóa, không chọn kỹ năng đại cương; nhưng hay chọn kỹ năng gần nghĩa với kỹ năng đã liên kết (NN004: 4/9 dòng), đánh dấu Bắt buộc quá nhiều (6 cho NN005 và NN003, kể cả kỹ năng mới), nhiều kỹ năng mềm và bỏ sót kỹ năng kỹ thuật cốt lõi (NN003 thiếu Python, ETL/ELT, Data warehouse; NN005 thiếu Scripting), có tên mới "Kỹ năng phân tích nghiệp vụ". Đây là lý do có v2 và phần hậu xử lý ở trên.
- Một lần chạy thật với v2 (cùng 3 vị trí, 25–33 giây, 1,1–1,3 nghìn token): Bắt buộc 2/4/5; kỹ năng mềm 1–2 mỗi vị trí; NN005 có Scripting và Python, NN003 có ETL/ELT; dòng gần nghĩa còn 1–2 mỗi vị trí và các cặp trùng chữ đều được đánh dấu "Gần giống" (NN004: Phân tích và quản lý yêu cầu ~ Phân tích yêu cầu; NN003: Phân tích thống kê ~ Thống kê). Còn lại: cặp gần nghĩa không trùng chữ (Phân tích và thiết kế hệ thống so với UML/BPMN) không được đánh dấu; kỹ năng mới có thể gần một kỹ năng trong danh mục (NN004: "Quản lý yêu cầu"), nhưng kỹ năng mới vốn bắt đầu chưa tích. Mới có một lần chạy nên cần thêm số liệu `applied_summary` theo `prompt_version`.
- Kiểm chứng lại v2 thêm 3 lần chạy (2 lần với prompt trên, 1 lần sau khi thêm câu "kỹ năng mềm và kiến thức nền tảng chung luôn là preferred"): kết quả dao động giữa các lần. Ổn định: Bắt buộc 2–4, không kỹ năng mới nào Bắt buộc, "Phân tích và quản lý yêu cầu" ~ "Phân tích yêu cầu" (NN004), "Phân tích thống kê" ~ "Thống kê" và "Truy vấn dữ liệu bằng SQL" ~ "SQL" (NN003) luôn được đánh dấu. Không ổn định: Scripting cho NN005 có ở 3/5 lần và Python 2/5, ETL/ELT cho NN003 chỉ 1/5 lần, Python cho NN003 và Data warehouse không lần nào. Trước câu bổ sung, NN005 luôn đánh dấu Bắt buộc "Vận dụng kiến thức nền tảng CNTT" và NN003 có lần đánh dấu Bắt buộc "Giao tiếp và thuyết trình"; sau câu bổ sung cả hai là Ưu tiên. Với NN005, nội dung yêu cầu hay chỉ chép lại tên kỹ năng ("Giám sát hệ thống"); thử thêm quy tắc "không chép lại tên kỹ năng" thì nội dung tốt hơn nhưng mô hình gán sai khóa ("Phân tích thống kê" với nội dung về bảo mật) nên không giữ. Kỹ năng mới hay gần nghĩa với kỹ năng có sẵn và đôi khi viết tiếng Anh ("Data visualization" trong khi nghề đã có "Trực quan hóa dữ liệu"); chúng bắt đầu chưa tích.

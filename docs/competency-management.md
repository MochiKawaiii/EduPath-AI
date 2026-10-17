# AD-COMP — quản lý cấu hình năng lực từ học phần

Màn hình quản trị **Năng lực** (`/quantri/danh-gia-nang-luc`) quản lý nhóm kỹ năng, danh mục kỹ năng đánh giá và liên kết, trọng số của từng học phần theo phiên bản CTĐT. Dùng PostgreSQL, session và quyền quản trị hiện có. Từ bản chức năng `Nhom1_DanhSachChucNang_ver0.2 (7)` (16/10/2026), liên kết và trọng số có thể do AI đề xuất (Gemma chạy cục bộ trên máy AI) và phần **Nhập từ Excel đã bị xóa**: dữ liệu không còn được nhập bằng tệp trọng số thủ công.

## Chức năng theo danh sách chức năng bản 7

| Chức năng | Cách đáp ứng |
| --- | --- |
| AD-COMP-01 Xem danh mục nhóm kỹ năng đánh giá | Tab **Nhóm kỹ năng**: bảng, tìm, lọc trạng thái, chi tiết và lịch sử. |
| AD-COMP-03 Thêm nhóm kỹ năng đánh giá, cập nhật nhóm | Nút **Thêm nhóm kỹ năng**; **Chỉnh sửa** trong menu Thao tác. |
| Xóa nhóm kỹ năng đánh giá | **Xóa** trong menu Thao tác: chỉ nhóm không còn kỹ năng; xóa mềm (`deleted_at`, `is_active=false`), tên được dùng lại. |
| AD-COMP-02 Xem danh sách kỹ năng đánh giá, AD-COMP-12 Tìm kiếm, AD-COMP-15 Lọc | Tab **Danh mục kỹ năng**: tìm có/không dấu, lọc nhóm và trạng thái. |
| AD-COMP-04 Thêm, AD-COMP-05 Cập nhật, Xóa kỹ năng đánh giá | Thêm (tạo kỹ năng chung mới hoặc dùng lại kỹ năng chung đã có), Chỉnh sửa, Xóa (xóa mềm, chặn khi cấu hình đang áp dụng còn dùng). |
| Thêm kỹ năng đánh giá (AI) | Nút **Thêm bằng AI** cạnh "Thêm hồ sơ năng lực": chọn CTĐT, AI đọc học phần và danh mục rồi đề xuất kỹ năng kèm nhóm, phạm vi đánh giá, lý do; quản trị viên duyệt, sửa rồi lưu (xem mục AI). |
| AD-COMP-06 Xem trọng số năng lực | Tab **Trọng số học phần**: tổng %, trạng thái, chi tiết và lịch sử từng học phần. |
| AD-COMP-09 Tạo liên kết kỹ năng với học phần (Thủ công) | **Tạo liên kết kỹ năng (Thủ công)**: chọn kỹ năng; kỹ năng mới vào học phần với trọng số 0%. |
| Tạo liên kết kỹ năng với học phần (AI) | **Tạo liên kết kỹ năng (AI)**: AI đề xuất kỹ năng, quản trị viên duyệt rồi lưu (xem mục AI). |
| AD-COMP-07 Thêm trọng số năng lực (Thủ công) | **Thêm trọng số (Thủ công)**: nhập % cho các kỹ năng đã liên kết; áp dụng cần tổng 100%. |
| Thêm trọng số năng lực (AI) | **Thêm trọng số (AI)**: AI chia 100%, quản trị viên sửa rồi lưu bản nháp hoặc áp dụng. |
| AD-COMP-08 Cập nhật trọng số, AD-COMP-10 Cập nhật liên kết | **Chỉnh sửa liên kết và trọng số**: trình chỉnh sửa đầy đủ (thêm, đổi, gỡ dòng và %). |
| AD-COMP-14 Xóa liên kết kỹ năng với học phần | **Xóa liên kết**: chọn kỹ năng cần gỡ. Học phần đang áp dụng mà tổng không còn 100% chuyển về bản nháp. |
| Xóa trọng số năng lực | **Xóa trọng số**: mọi trọng số về 0%, học phần về bản nháp, liên kết giữ nguyên. |
| (mở rộng) Chạy AI cho cả chương trình | Khung **Chạy AI cho cả chương trình** trên tab Trọng số học phần (xem mục AI). |
| (mở rộng) Xóa liên kết của cả chương trình | Nút **Xóa liên kết của N học phần** trong cùng khung: nhập mã khóa (ví dụ K30) để xác nhận; mọi học phần có liên kết về bản nháp trống (lịch sử giữ nguyên) để chạy AI lại cho cả chương trình. |

Tên tab và nút giữ như hiện tại ("Nhóm kỹ năng", "Danh mục kỹ năng"); ghi chú GVHD về "Nhóm năng lực" / "Cấu hình năng lực" chưa áp dụng.

## Dữ liệu

Migration **026** tạo các bảng; **034** thêm xóa mềm nhóm và bảng đề xuất AI; **035** thêm chế độ `skills` (đề xuất cho cả phiên bản CTĐT, `course_code` NULL, một đề xuất chờ cho mỗi phiên bản).

| Bảng | Vai trò |
| --- | --- |
| `ad_comp_groups` | Nhóm, mô tả, trạng thái, token phiên bản, `deleted_at` (034). Tên duy nhất trong các nhóm chưa xóa. |
| `ad_comp_skills` | Hồ sơ đánh giá theo **`career_skills.id`** (khóa chính cũng là khóa ngoại): nhóm, phạm vi, trạng thái, xóa mềm. Mọi kỹ năng năng lực vì vậy luôn là kỹ năng chung của mục Nghề nghiệp. |
| `ad_comp_course_configs` | Cấu hình theo `(phiên bản CTĐT, mã học phần)`: trạng thái `draft`/`active`/`archived`, token, ghi chú. |
| `ad_comp_course_links` | Liên kết kỹ năng–học phần **kèm trọng số** `[0,1]`: liên kết và trọng số là cùng một dòng. Trọng số là phần của kỹ năng trong 100% của học phần. |
| `ad_comp_events` | Snapshot mỗi lần lưu, người thực hiện, thời gian. |
| `ad_comp_ai_suggestions` (034) | Vừa là việc của máy AI vừa là bản ghi kiểm toán: chế độ `links`/`weights`/`full`/`skills`, `batch_id` của lần chạy cho cả chương trình, trạng thái, kết quả đã kiểm tra, model, thời điểm và người lưu. `ai_input` bị xóa khi việc kết thúc. |
| `ad_comp_import_aliases`, `ad_comp_imports` | Còn lại từ phần nhập Excel đã xóa; không còn được đọc hay ghi. |

Quy tắc giữ nguyên: bản nháp có thể chưa đủ 100%; **đang áp dụng** cần ít nhất một kỹ năng khả dụng và tổng bằng 1 (dung sai `1e-6`, kiểm tra cả ở trigger deferred); trọng số 0% được giữ nhưng không đóng góp. Mọi lần lưu thay toàn bộ danh sách liên kết trong một giao dịch, giữ khóa catalog chung với Nghề nghiệp và token `x-version`. Mỗi phiên bản CTĐT độc lập; không tự chép trọng số giữa các phiên bản. Điểm năng lực sinh viên chỉ đọc cấu hình **đang áp dụng** có trọng số > 0 (`competency-assessment/inputs.ts`). Áp dụng cấu hình ở một phiên bản CTĐT mới hơn chuyển cả khóa sang dùng phiên bản đó.

## API

Prefix **`/api/admin/competencies`**; mọi endpoint cần quyền quản trị (`admin`, `faculty_board`, `department_head`, `lecturer`), write cần Origin đúng và kiểm tra quyền lại trong giao dịch.

| Method / đường dẫn | Chức năng |
| --- | --- |
| GET `/groups`, GET `/groups/:id` | Nhóm chưa xóa, số kỹ năng, chi tiết và lịch sử. |
| POST `/groups`, PATCH `/groups/:id` | Thêm, cập nhật (`x-version`). |
| DELETE `/groups/:id` | Xóa mềm; `x-version` + `{confirmed:true}`; 409 `group_not_empty` khi còn kỹ năng. |
| GET `/catalog` | Kỹ năng chung dùng lại được. |
| GET/POST `/skills`, GET/PATCH/DELETE `/skills/:id` | Danh mục kỹ năng đánh giá. |
| GET `/curricula`, GET `/courses?revisionId=`, GET `/courses/:revisionId/:code`, GET `/summary?revisionId=` | Phiên bản CTĐT, học phần, chi tiết, thống kê và cảnh báo. |
| PUT `/courses/:revisionId/:code` | Lưu toàn bộ liên kết và trọng số `{status,links:[{skillId,weight}],note}`; mọi thao tác thủ công trên giao diện (tạo liên kết, thêm/xóa trọng số, xóa liên kết) dùng endpoint này. |
| POST `/courses/clear` | `{revisionId,confirm}`: `confirm` là mã khóa (không phân biệt hoa thường), sai thì 400 `confirmation_mismatch`. Mọi học phần có liên kết của phiên bản thành bản nháp không liên kết, mỗi học phần một dòng lịch sử; trả `{cleared}`. |
| DELETE `/courses/:revisionId/:code` | Lưu trữ cấu hình (giữ cho tương thích, giao diện không còn dùng). |
| `/ai/*` | Đề xuất AI, mục dưới. |

Đường `/import/preview`, `/import`, lệnh `db:import-competencies` và `workers/competency.mjs` đã bị xóa.

## AI đề xuất liên kết, trọng số và kỹ năng

Bật khi server có `AI_WORKER_KEY` (như các tính năng AI khác). Việc chạy trên máy AI cục bộ (Ollama `gemma4:e4b`), loại việc `competency_course_suggestion_v2`; máy AI lấy loại này **sau cùng** (sau nghề nghiệp, lời khuyên tốt nghiệp và nhận xét năng lực của sinh viên) nên một lần chạy cho cả chương trình không làm sinh viên phải chờ. AI chỉ nhận dữ liệu CTĐT (tên, mô tả, khối kiến thức, loại, tín chỉ, số giờ học phần) và danh mục kỹ năng; không nhận dữ liệu sinh viên.

**Chế độ suy luận (từ 17/10/2026, prompt v2).** Mọi việc AI của mục Năng lực chạy Gemma với `think: true`: mô hình suy luận trước khi trả lời. Không có suy luận, gemma4:e4b gắn "Nhập môn Công nghệ thông tin" với pháp luật và quốc phòng (dữ liệu K30 trên production). Nguyên nhân đọc được trong phần suy luận: mọi học phần K29–K32 đều **chưa có mô tả**, mô hình hiểu "BB" là giáo dục đại cương, và nhóm "Kiến thức nền tảng" trộn kỹ năng CNTT với pháp luật, chính trị, quốc phòng. Prompt v2 vì vậy ghi loại học phần bằng chữ (Bắt buộc / Tự chọn), cấm suy đoán ngoài tên học phần, và dùng khối kiến thức để quyết định loại kỹ năng: học phần khối Lý luận chính trị, GDTC-GDQP, Ngoại ngữ, Đại cương chỉ nhận kỹ năng đúng môn; học phần chuyên môn không nhận kỹ năng chính trị, pháp luật, quốc phòng, thể chất, môi trường, tiếng Anh trừ khi tên học phần nói rõ. Chạy thử cục bộ 17/10 (K30, có suy luận): Nhập môn CNTT → nền tảng CNTT 60% + công nghệ số 40%; Pháp luật đại cương → pháp luật 100%; Bóng chuyền → thể chất 70% + làm việc nhóm 30%; Lập trình ứng dụng Web → HTML/CSS/JS, OOP, phân tích thiết kế, SQL, REST API; Đồ án thực tập → dự án CNTT, quản lý dự án, làm việc nhóm, viết báo cáo. Thời gian 28–104 giây mỗi học phần (trước đây khoảng 26 giây). Phần suy luận không được lưu.

Việc v2 gửi `think: true` trong job; worker trước 17/10/2026 luôn gửi `think: false` và báo loại cũ `competency_course_suggestion`, nên server không giao việc v2 cho nó (trang báo "Máy AI đang chạy phiên bản cũ…"). **Phải khởi động lại worker** để dùng các nút AI của mục Năng lực.

| Chế độ | Prompt | AI trả về | Lưu |
| --- | --- | --- | --- |
| `links` — Tạo liên kết kỹ năng (AI) | `comp-link-v2` | Tối đa 8 kỹ năng theo khóa `S001…` + nhóm `G1…`, tối đa 2 kỹ năng mới theo tên, lý do ngắn | Kỹ năng được chọn vào học phần với 0%; học phần đang áp dụng vẫn áp dụng (tổng không đổi), học phần mới thành bản nháp. |
| `weights` — Thêm trọng số (AI) | `comp-weight-v2` | % nguyên cho từng kỹ năng đã liên kết | Trọng số đã duyệt thay trọng số cũ; lưu bản nháp hoặc áp dụng. 409 `links_changed` nếu liên kết đã đổi. |
| `full` — cả chương trình | `comp-course-v2` | Tối đa 8 kỹ năng kèm %, không kỹ năng mới | "Lưu tất cả thành bản nháp" hoặc "Lưu và áp dụng" (cần tick xác nhận); mỗi học phần một savepoint, học phần có liên kết từ trước bị bỏ qua. |
| `skills` — Thêm kỹ năng (AI), tab Danh mục kỹ năng | `comp-skill-v2` | Đọc mọi học phần của một phiên bản CTĐT (tên, khối kiến thức, tín chỉ, 80 ký tự mô tả) cùng tên các kỹ năng đã có trong danh mục; trả tối đa 12 kỹ năng nghề chưa đo theo khóa và tối đa 8 kỹ năng mới theo tên, mỗi kỹ năng kèm nhóm, phạm vi đánh giá, lý do (kỹ năng mới thêm mô tả) | Mỗi dòng được chọn thành hồ sơ năng lực với nhóm và phạm vi đã sửa; tên mới vào danh mục chung của Nghề nghiệp kèm mô tả. Kỹ năng vừa có hồ sơ trong lúc chờ → 409 `skill_already_in_catalog` kèm tên. Liên kết với học phần làm sau ở tab Trọng số học phần. `num_predict` 12288. |

- **Ứng viên**: hồ sơ đang dùng (theo nhóm rồi tên) và **kỹ năng nghề nghiệp chưa đo** — kỹ năng chung mà nghề còn yêu cầu nhưng chưa có hồ sơ năng lực (Docker, Linux…). Khi lưu, kỹ năng nghề chưa đo được tạo hồ sơ trong nhóm AI chọn (quản trị viên đổi được); kỹ năng mới được thêm vào danh mục chung của Nghề nghiệp rồi tạo hồ sơ. Nhờ vậy kỹ năng do AI tạo luôn dùng được cho nghề nghiệp, và kỹ năng nghề chưa đo trở nên đo được.
- **Kiểm tra phía server** (`competencies/ai/validate.ts`): khóa lạ, lặp hoặc đã liên kết bị bỏ; ở chế độ `skills`, tên trùng kỹ năng đã có trong danh mục (không phân biệt hoa thường, dấu) bị bỏ, tên trùng một kỹ năng nghề chưa đo thành chính kỹ năng đó, nhóm lạ thành nhóm đầu tiên; khóa viết trong câu được thay bằng tên; lý do có link/HTML bị xóa trắng. Phần trăm được kẹp 0–100, làm tròn và chia lại để **tổng đúng 100** (phương pháp phần dư lớn nhất) vì ngữ pháp JSON không ép được tổng; chế độ weights luôn đủ mọi kỹ năng đã liên kết (thiếu thì 0). Không còn mục hợp lệ → `invalid_ai_output`; câu trả lời rỗng là đề xuất rỗng hợp lệ.
- **Hàng đợi**: một đề xuất chờ cho mỗi (phiên bản, học phần, chế độ), và cho mỗi phiên bản ở chế độ `skills`; tối đa 300 việc chờ; lease 15 phút (worker gia hạn 3 phút một lần), 2 lần thử; việc chờ quá 24 giờ thành `worker_timeout`. Ollama `num_ctx` 16384 (prompt một học phần khoảng 5,3K token), `num_predict` 8192 (`skills` 12288) cho cả phần suy luận lẫn câu trả lời, nhiệt độ 0,2, `think: true`. Phần danh mục đứng trước học phần trong prompt để các việc liên tiếp dùng chung tiền tố.
- **API** `/api/admin/competencies/ai`: GET `/status`; GET `/latest?revisionId&code&mode`; POST `/` `{revisionId,code,mode}`; GET `/:id`; POST `/:id/cancel`; POST `/:id/apply` (links `{items:[{skillId|null,skillName,groupId|null}]}`, weights `{weights:[{skillId,percent}],status}`); GET `/batches/latest?revisionId`; POST `/batches` `{revisionId}`; POST `/batches/:id/cancel`; POST `/batches/:id/apply` `{status}`; GET `/skills/latest?revisionId`; POST `/skills` `{revisionId}`; POST `/:id/apply` của đề xuất `skills` nhận `{items:[{skillId|null,skillName,groupId,scope,description}]}` (1–30 dòng). Loại việc của máy AI vẫn là `competency_course_suggestion` và câu trả lời giữ tên trường `links`/`newSkills`, nên worker không cần khởi động lại cho chế độ này.
- **Giới hạn**: chất lượng phụ thuộc Gemma E4B; đề xuất luôn cần quản trị viên xem lại. Phần trăm là ước lượng của AI, không phải tri thức chuyên gia. Lưu và áp dụng cả chương trình làm điểm năng lực của sinh viên khóa đó tính theo trọng số AI ngay.

## Kiểm thử

- Đơn vị: `competencies/model.test.ts`, `competencies/router.test.ts`, `competencies/ai/{prompt,validate}.test.ts`, các test loại việc mới trong `competency-assessment/ai/worker-router.test.ts`, `ai-worker/{client,ollama}.test.ts`; web `competency-ai.test.ts`, `CompetencyCourseAi.test.tsx`, `CompetencySkillAi.test.tsx`, `competency-weights.test.ts`.
- Tích hợp PostgreSQL: `node scripts/verify-competency-ai.mjs` (sau `npm run build -w @edupath/api`) chạy migration 007–035 trong schema tạm, chép dữ liệu quản trị cục bộ ở chế độ chỉ đọc, giả lập câu trả lời của AI qua router thật: xóa nhóm, AI tạo liên kết (kỹ năng nghề chưa đo, kỹ năng mới), AI chia trọng số rồi áp dụng, chạy cho cả chương trình (16/10/2026: K31, 88 học phần, 71 bản nháp đủ 100%, 17 câu trả lời rỗng), thêm kỹ năng bằng AI cho cả phiên bản (17/10/2026: 2 kỹ năng nghề + 1 kỹ năng mới thành hồ sơ, tên trùng danh mục bị bỏ, 409 khi kỹ năng đã có), hủy lần chạy, hết hạn; schema public không đổi. Script cũ `verify-competencies.mjs` (dựa trên nhập Excel) đã bị xóa.

## Lịch sử

- 10/2026: AD-COMP ban đầu (migration 026) nhập 81 kỹ năng, 88 cấu hình và 289 liên kết K29 từ workbook `EduPath_course_K29.xlsx` vào PostgreSQL cục bộ qua phần nhập Excel. Dữ liệu đó vẫn giữ nguyên sau khi phần nhập bị xóa.
- 16/10/2026: theo danh sách chức năng bản 7, thêm xóa nhóm, các nút Thủ công/AI cho liên kết và trọng số, chạy AI cho cả chương trình; xóa phần nhập Excel.
- 17/10/2026: thêm nút **Thêm bằng AI** ở tab Danh mục kỹ năng (migration 035, chế độ `skills`).
- 17/10/2026 (sau): người dùng không chấp nhận liên kết, trọng số K30 do AI không suy luận tạo trên production. Bật chế độ suy luận cho mọi việc AI của mục Năng lực (prompt v2, loại việc `competency_course_suggestion_v2`), thêm nút **Xóa liên kết của cả chương trình** để chạy lại.

# AD-COMP — quản lý cấu hình năng lực từ học phần

Nhóm **Quản lý năng lực** trên thanh bên quản trị (mở/đóng như nhóm Quản lý nghề nghiệp) có ba trang: **Nhóm năng lực** (`/quantri/nhom-nang-luc`), **Cấu hình năng lực** (`/quantri/cau-hinh-nang-luc`) và **Cấu hình học phần** (`/quantri/cau-hinh-hoc-phan`); đường cũ `/quantri/danh-gia-nang-luc` mở trang Nhóm năng lực. Các trang này quản lý nhóm năng lực, cấu hình năng lực của từng kỹ năng và liên kết, trọng số của từng học phần theo phiên bản CTĐT. Dùng PostgreSQL, session và quyền quản trị hiện có. Từ bản chức năng `Nhom1_DanhSachChucNang_ver0.2 (7)` (16/10/2026), liên kết và trọng số có thể do AI đề xuất (Gemma chạy cục bộ trên máy AI) và phần **Nhập từ Excel đã bị xóa**: dữ liệu không còn được nhập bằng tệp trọng số thủ công.

## Chức năng theo danh sách chức năng bản 7

| Chức năng | Cách đáp ứng |
| --- | --- |
| AD-COMP-01 Xem danh mục nhóm kỹ năng đánh giá | Trang **Nhóm năng lực**: bảng, tìm, lọc trạng thái, chi tiết và lịch sử. |
| AD-COMP-03 Thêm nhóm kỹ năng đánh giá, cập nhật nhóm | Nút **Thêm nhóm năng lực**; **Chỉnh sửa nhóm năng lực** trong menu Thao tác. |
| Xóa nhóm kỹ năng đánh giá | **Xóa nhóm năng lực** trong menu Thao tác: chỉ nhóm không còn kỹ năng; xóa mềm (`deleted_at`, `is_active=false`), tên được dùng lại. |
| AD-COMP-02 Xem danh sách kỹ năng đánh giá, AD-COMP-12 Tìm kiếm, AD-COMP-15 Lọc | Trang **Cấu hình năng lực**: tìm có/không dấu, lọc nhóm năng lực và trạng thái. |
| AD-COMP-04 Thêm, AD-COMP-05 Cập nhật, Xóa kỹ năng đánh giá | Thêm (tạo kỹ năng chung mới hoặc dùng lại kỹ năng chung đã có), Chỉnh sửa, Xóa (xóa mềm, chặn khi cấu hình đang áp dụng còn dùng). |
| AD-COMP-06 Xem trọng số năng lực | Trang **Cấu hình học phần** (trước là tab "Trọng số học phần"): tổng %, trạng thái, chi tiết và lịch sử từng học phần. |
| AD-COMP-09 Tạo liên kết kỹ năng với học phần (Thủ công) | **Tạo liên kết kỹ năng (Thủ công)**: chọn kỹ năng; kỹ năng mới vào học phần với trọng số 0%. |
| Tạo liên kết kỹ năng với học phần (AI) | **Tạo liên kết kỹ năng (AI)**: AI đề xuất kỹ năng, quản trị viên duyệt rồi lưu (xem mục AI). |
| AD-COMP-07 Thêm trọng số năng lực (Thủ công) | **Thêm trọng số (Thủ công)**: nhập % cho các kỹ năng đã liên kết; áp dụng cần tổng 100%. |
| Thêm trọng số năng lực (AI) | **Thêm trọng số (AI)**: AI chia 100%, quản trị viên sửa rồi lưu bản nháp hoặc áp dụng. |
| AD-COMP-08 Cập nhật trọng số, AD-COMP-10 Cập nhật liên kết | **Chỉnh sửa liên kết và trọng số**: trình chỉnh sửa đầy đủ (thêm, đổi, gỡ dòng và %). |
| AD-COMP-14 Xóa liên kết kỹ năng với học phần | **Xóa liên kết**: chọn kỹ năng cần gỡ. Học phần đang áp dụng mà tổng không còn 100% chuyển về bản nháp. |
| Xóa trọng số năng lực | **Xóa trọng số**: mọi trọng số về 0%, học phần về bản nháp, liên kết giữ nguyên. |
| (mở rộng) Chạy AI cho cả chương trình | Khung **Chạy AI cho cả chương trình** trên trang Cấu hình học phần (xem mục AI). |
| (mở rộng) Áp dụng bản nháp của cả chương trình | Nút **Áp dụng N bản nháp** trong khung Chạy AI cho cả chương trình (cần tick xác nhận): mọi bản nháp có liên kết và tổng 100% thành Đang áp dụng; bản nháp chưa có liên kết, chưa đủ 100% hoặc có kỹ năng ngừng dùng được bỏ qua kèm lý do. |
| (mở rộng) Xóa liên kết của cả chương trình | Nút **Xóa liên kết của N học phần** trong cùng khung: nhập mã khóa (ví dụ K30) để xác nhận; mọi học phần có liên kết về bản nháp trống (lịch sử giữ nguyên) để chạy AI lại cho cả chương trình. |

**Thuật ngữ (17/10/2026, theo ghi chú GVHD ở AD-COMP-01/02):**

| Thuật ngữ | Nghĩa | Ví dụ |
| --- | --- | --- |
| **Nhóm năng lực** | Nhóm chứa các kỹ năng dùng để đánh giá (trước gọi "Nhóm kỹ năng") | Chuyên môn, Kiến thức nền tảng, Kỹ năng mềm |
| **Kỹ năng** | Một kỹ năng trong kho kỹ năng dùng chung của mục Nghề nghiệp | SQL, Git, Làm việc nhóm |
| **Cấu hình năng lực** | Một kỹ năng được đưa vào đánh giá năng lực: kỹ năng + nhóm năng lực + phạm vi đánh giá + trạng thái (trước gọi "hồ sơ năng lực") | SQL · Chuyên môn · "Đánh giá qua truy vấn…" |

Tab "Danh mục kỹ năng" đổi thành **Cấu hình năng lực**, nút "Thêm hồ sơ năng lực" thành **Thêm cấu hình năng lực**, tab "Nhóm kỹ năng" thành **Nhóm năng lực**, tab "Trọng số học phần" thành **Cấu hình học phần** (liên kết kỹ năng và trọng số của từng học phần; khái niệm "trọng số học phần" vẫn giữ trong văn bản). Trang sinh viên (Đánh giá năng lực, câu hỏi thường gặp) và prompt nhận xét AI cho sinh viên (`comp-v6`) cũng dùng "nhóm năng lực"; chính sách quyền riêng tư (bản 2026-10-11) giữ nguyên chữ. Cấu hình của **học phần** (liên kết và trọng số) vẫn gọi là "cấu hình học phần". Prompt AI của mục Năng lực (gửi cho mô hình) không đổi. Tên mã giữ nguyên: bảng `ad_comp_groups`, `ad_comp_skills`, API `/groups`, `/skills`.

## Dữ liệu

Migration **026** tạo các bảng; **034** thêm xóa mềm nhóm và bảng đề xuất AI; **035** thêm chế độ `skills` cho nút "Thêm bằng AI" của trang Cấu hình năng lực (khi đó là tab "Danh mục kỹ năng") (`course_code` NULL); nút này đã được gỡ ngày 17/10/2026 theo yêu cầu, **036** hủy các đề xuất `skills` còn chờ. Giá trị `skills` trong ràng buộc chế độ và `course_code` cho phép NULL vẫn giữ vì 035 đã chạy trên production; không còn mã nào tạo dòng `skills`.

| Bảng | Vai trò |
| --- | --- |
| `ad_comp_groups` | Nhóm, mô tả, trạng thái, token phiên bản, `deleted_at` (034). Tên duy nhất trong các nhóm chưa xóa. |
| `ad_comp_skills` | Cấu hình năng lực theo **`career_skills.id`** (khóa chính cũng là khóa ngoại): nhóm, phạm vi, trạng thái, xóa mềm. Mọi kỹ năng năng lực vì vậy luôn là kỹ năng chung của mục Nghề nghiệp. |
| `ad_comp_course_configs` | Cấu hình theo `(phiên bản CTĐT, mã học phần)`: trạng thái `draft`/`active`/`archived`, token, ghi chú. |
| `ad_comp_course_links` | Liên kết kỹ năng–học phần **kèm trọng số** `[0,1]`: liên kết và trọng số là cùng một dòng. Trọng số là phần của kỹ năng trong 100% của học phần. |
| `ad_comp_events` | Snapshot mỗi lần lưu, người thực hiện, thời gian. |
| `ad_comp_ai_suggestions` (034) | Vừa là việc của máy AI vừa là bản ghi kiểm toán: chế độ `links`/`weights`/`full` (dòng `skills` cũ chỉ còn là bản ghi), `batch_id` của lần chạy cho cả chương trình, trạng thái, kết quả đã kiểm tra, model, thời điểm và người lưu. `ai_input` bị xóa khi việc kết thúc. |
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
| GET/POST `/skills`, GET/PATCH/DELETE `/skills/:id` | Cấu hình năng lực. |
| GET `/curricula`, GET `/courses?revisionId=`, GET `/courses/:revisionId/:code`, GET `/summary?revisionId=` | Phiên bản CTĐT, học phần, chi tiết, thống kê và cảnh báo. |
| PUT `/courses/:revisionId/:code` | Lưu toàn bộ liên kết và trọng số `{status,links:[{skillId,weight}],note}`; mọi thao tác thủ công trên giao diện (tạo liên kết, thêm/xóa trọng số, xóa liên kết) dùng endpoint này. |
| POST `/courses/activate` | `{revisionId,confirmed:true}`: áp dụng mọi bản nháp của phiên bản, mỗi học phần một savepoint; trả `{activated,skipped:[{courseCode,reason}]}` (`course_has_no_links`, `weight_total_invalid`, `skill_unavailable`, `group_unavailable`). |
| POST `/courses/clear` | `{revisionId,confirm}`: `confirm` là mã khóa (không phân biệt hoa thường), sai thì 400 `confirmation_mismatch`. Mọi học phần có liên kết của phiên bản thành bản nháp không liên kết, mỗi học phần một dòng lịch sử; trả `{cleared}`. |
| DELETE `/courses/:revisionId/:code` | Lưu trữ cấu hình (giữ cho tương thích, giao diện không còn dùng). |
| `/ai/*` | Đề xuất AI, mục dưới. |

Đường `/import/preview`, `/import`, lệnh `db:import-competencies` và `workers/competency.mjs` đã bị xóa.

## AI đề xuất liên kết và trọng số

Bật khi server có `AI_WORKER_KEY` (như các tính năng AI khác). Việc chạy trên máy AI cục bộ (Ollama `gemma4:e4b`), loại việc `competency_course_suggestion_v2`; máy AI lấy loại này **sau cùng** (sau nghề nghiệp, lời khuyên tốt nghiệp và nhận xét năng lực của sinh viên) nên một lần chạy cho cả chương trình không làm sinh viên phải chờ. AI chỉ nhận dữ liệu CTĐT (tên, mô tả, khối kiến thức, loại, tín chỉ, số giờ học phần) và các kỹ năng (cấu hình năng lực, kỹ năng nghề chưa đo); không nhận dữ liệu sinh viên.

**Chế độ suy luận (từ 17/10/2026, prompt v2).** Mọi việc AI của mục Năng lực chạy Gemma với `think: true`: mô hình suy luận trước khi trả lời. Không có suy luận, gemma4:e4b gắn "Nhập môn Công nghệ thông tin" với pháp luật và quốc phòng (dữ liệu K30 trên production). Nguyên nhân đọc được trong phần suy luận: mọi học phần K29–K32 đều **chưa có mô tả**, mô hình hiểu "BB" là giáo dục đại cương, và nhóm "Kiến thức nền tảng" trộn kỹ năng CNTT với pháp luật, chính trị, quốc phòng. Prompt v2 vì vậy ghi loại học phần bằng chữ (Bắt buộc / Tự chọn), cấm suy đoán ngoài tên học phần, và dùng khối kiến thức để quyết định loại kỹ năng: học phần khối Lý luận chính trị, GDTC-GDQP, Ngoại ngữ, Đại cương chỉ nhận kỹ năng đúng môn; học phần chuyên môn không nhận kỹ năng chính trị, pháp luật, quốc phòng, thể chất, môi trường, tiếng Anh trừ khi tên học phần nói rõ. Chạy thử cục bộ 17/10 (K30, có suy luận): Nhập môn CNTT → nền tảng CNTT 60% + công nghệ số 40%; Pháp luật đại cương → pháp luật 100%; Bóng chuyền → thể chất 70% + làm việc nhóm 30%; Lập trình ứng dụng Web → HTML/CSS/JS, OOP, phân tích thiết kế, SQL, REST API; Đồ án thực tập → dự án CNTT, quản lý dự án, làm việc nhóm, viết báo cáo. Thời gian 28–104 giây mỗi học phần (trước đây khoảng 26 giây). Phần suy luận không được lưu.

Việc v2 gửi `think: true` trong job; worker trước 17/10/2026 luôn gửi `think: false` và báo loại cũ `competency_course_suggestion`, nên server không giao việc v2 cho nó (trang báo "Máy AI đang chạy phiên bản cũ…"). **Phải khởi động lại worker** để dùng các nút AI của mục Năng lực.

| Chế độ | Prompt | AI trả về | Lưu |
| --- | --- | --- | --- |
| `links` — Tạo liên kết kỹ năng (AI) | `comp-link-v2` | Tối đa 8 kỹ năng theo khóa `S001…` + nhóm `G1…`, tối đa 2 kỹ năng mới theo tên, lý do ngắn | Kỹ năng được chọn vào học phần với 0%; học phần đang áp dụng vẫn áp dụng (tổng không đổi), học phần mới thành bản nháp. |
| `weights` — Thêm trọng số (AI) | `comp-weight-v2` | % nguyên cho từng kỹ năng đã liên kết | Trọng số đã duyệt thay trọng số cũ; lưu bản nháp hoặc áp dụng. 409 `links_changed` nếu liên kết đã đổi. |
| `full` — cả chương trình | `comp-course-v2` | Tối đa 8 kỹ năng kèm %, không kỹ năng mới | "Lưu tất cả thành bản nháp" hoặc "Lưu và áp dụng" (cần tick xác nhận); mỗi học phần một savepoint, học phần có liên kết từ trước bị bỏ qua. |

- **Ứng viên**: cấu hình năng lực đang dùng (theo nhóm rồi tên) và **kỹ năng nghề nghiệp chưa đo** — kỹ năng chung mà nghề còn yêu cầu nhưng chưa có cấu hình năng lực (Docker, Linux…). Khi lưu, kỹ năng nghề chưa đo được tạo cấu hình năng lực trong nhóm AI chọn (quản trị viên đổi được); kỹ năng mới được thêm vào kho kỹ năng chung của Nghề nghiệp rồi tạo cấu hình. Nhờ vậy kỹ năng do AI tạo luôn dùng được cho nghề nghiệp, và kỹ năng nghề chưa đo trở nên đo được.
- **Kiểm tra phía server** (`competencies/ai/validate.ts`): khóa lạ, lặp hoặc đã liên kết bị bỏ; khóa viết trong câu được thay bằng tên; lý do có link/HTML bị xóa trắng. Phần trăm được kẹp 0–100, làm tròn và chia lại để **tổng đúng 100** (phương pháp phần dư lớn nhất) vì ngữ pháp JSON không ép được tổng; chế độ weights luôn đủ mọi kỹ năng đã liên kết (thiếu thì 0). Không còn mục hợp lệ → `invalid_ai_output`; câu trả lời rỗng là đề xuất rỗng hợp lệ.
- **Hàng đợi**: một đề xuất chờ cho mỗi (phiên bản, học phần, chế độ); tối đa 300 việc chờ; lease 15 phút (worker gia hạn 3 phút một lần), 2 lần thử; việc chờ quá 24 giờ thành `worker_timeout`. Ollama `num_ctx` 16384 (prompt một học phần khoảng 5,3K token), `num_predict` 8192 cho cả phần suy luận lẫn câu trả lời, nhiệt độ 0,2, `think: true`. Phần danh mục đứng trước học phần trong prompt để các việc liên tiếp dùng chung tiền tố.
- **API** `/api/admin/competencies/ai`: GET `/status`; GET `/latest?revisionId&code&mode`; POST `/` `{revisionId,code,mode}`; GET `/:id`; POST `/:id/cancel`; POST `/:id/apply` (links `{items:[{skillId|null,skillName,groupId|null}]}`, weights `{weights:[{skillId,percent}],status}`); GET `/batches/latest?revisionId`; POST `/batches` `{revisionId}`; POST `/batches/:id/cancel`; POST `/batches/:id/apply` `{status}`.
- **Giới hạn**: chất lượng phụ thuộc Gemma E4B; đề xuất luôn cần quản trị viên xem lại. Phần trăm là ước lượng của AI, không phải tri thức chuyên gia. Lưu và áp dụng cả chương trình làm điểm năng lực của sinh viên khóa đó tính theo trọng số AI ngay.

## Kiểm thử

- Đơn vị: `competencies/model.test.ts`, `competencies/router.test.ts`, `competencies/ai/{prompt,validate}.test.ts`, các test loại việc mới trong `competency-assessment/ai/worker-router.test.ts`, `ai-worker/{client,ollama}.test.ts`; web `competency-ai.test.ts`, `CompetencyCourseAi.test.tsx`, `CompetencyBulkAi.test.tsx`, `competency-weights.test.ts`.
- Tích hợp PostgreSQL: `node scripts/verify-competency-ai.mjs` (sau `npm run build -w @edupath/api`) chạy migration 007–036 trong schema tạm, chép dữ liệu quản trị cục bộ ở chế độ chỉ đọc, giả lập câu trả lời của AI qua router thật: xóa nhóm, AI tạo liên kết (kỹ năng nghề chưa đo, kỹ năng mới), AI chia trọng số rồi áp dụng, chạy cho cả chương trình (16/10/2026: K31, 88 học phần, 71 bản nháp đủ 100%, 17 câu trả lời rỗng), xóa liên kết của cả chương trình rồi chạy lại, migration 036 hủy đề xuất `skills` còn chờ, hủy lần chạy, hết hạn; schema public không đổi. Script cũ `verify-competencies.mjs` (dựa trên nhập Excel) đã bị xóa.

## Lịch sử

- 10/2026: AD-COMP ban đầu (migration 026) nhập 81 kỹ năng, 88 cấu hình và 289 liên kết K29 từ workbook `EduPath_course_K29.xlsx` vào PostgreSQL cục bộ qua phần nhập Excel. Dữ liệu đó vẫn giữ nguyên sau khi phần nhập bị xóa.
- 16/10/2026: theo danh sách chức năng bản 7, thêm xóa nhóm, các nút Thủ công/AI cho liên kết và trọng số, chạy AI cho cả chương trình; xóa phần nhập Excel.
- 17/10/2026: thêm nút **Thêm bằng AI** ở tab Danh mục kỹ năng (migration 035, chế độ `skills`), rồi gỡ trong cùng ngày theo yêu cầu (migration 036); thêm kỹ năng chỉ còn nút thủ công.
- 17/10/2026 (sau): thống nhất thuật ngữ Nhóm năng lực / Kỹ năng / Cấu hình năng lực (bảng ở đầu tài liệu); tab "Trọng số học phần" đổi tên thành Cấu hình học phần; rồi ba tab của trang "Năng lực" được tách thành ba trang trong nhóm **Quản lý năng lực** trên thanh bên.
- 17/10/2026 (sau): người dùng không chấp nhận liên kết, trọng số K30 do AI không suy luận tạo trên production. Bật chế độ suy luận cho mọi việc AI của mục Năng lực (prompt v2, loại việc `competency_course_suggestion_v2`), thêm nút **Xóa liên kết của cả chương trình** để chạy lại.

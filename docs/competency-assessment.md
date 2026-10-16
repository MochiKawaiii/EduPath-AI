# Đánh giá năng lực sinh viên và nhận xét AI

Cổng sinh viên tính năng lực từ bảng điểm, so với nghề mục tiêu, gợi ý học phần và (nếu bật) kèm nhận xét tiếng Việt do một LLM chạy cục bộ viết. Khi server có `ANTHROPIC_API_KEY`, đánh giá chạy ở chế độ **AI 100%** (mục "AI 100%" bên dưới): Claude Haiku 5.5 tự tính các con số hiển thị, rồi chọn học phần và viết nhận xét. Một lần đánh giá được lưu và hiển thị trên hai trang riêng, theo hai nhóm chức năng:

| Trang | Nhóm chức năng | Nội dung |
|---|---|---|
| `#competency` "Đánh giá năng lực" | STU-COMP | Điểm tổng, điểm và mức theo nhóm kỹ năng; "Theo dõi năng lực theo học kỳ" (STU-COMP-07: điểm tổng, mức và điểm từng nhóm ở cuối mỗi học kỳ, nhóm theo năm học, kèm thay đổi so với học kỳ trước); "Bảng phân tích mức độ thành thạo theo nhóm kỹ năng" (ý nghĩa kết quả, số kỹ năng ở từng mức của mỗi nhóm, bấm số để lọc danh sách, học phần minh chứng của từng kỹ năng); phần nhận xét AI về năng lực; tiến độ so với KHĐT (chậm: đỏ, đúng kế hoạch: xanh); xét tốt nghiệp tham khảo; cảnh báo dữ liệu và cách tính điểm. Nút "Xóa kết quả đánh giá" chỉ có ở trang này. |
| `#skill-gap` "Khoảng trống kỹ năng" | STU-GAP | Mức phù hợp với nghề mục tiêu và kỹ năng còn thiếu cùng mức thiếu hụt; phần nhận xét AI về khoảng trống (`careerFit`, `gaps`); báo cáo chi tiết khoảng trống (bảng điểm hiện tại so với ngưỡng); học phần nên ưu tiên (mỗi học phần ghi tình trạng của sinh viên: chưa học, đã học và điểm, cần học lại, và điều kiện đăng ký), học cải thiện, kỹ năng cần tự học; cách tính mức phù hợp. |

Cả hai trang dùng cùng component `StudentCompetency` (thuộc tính `view`), cùng nút "Đánh giá lại" và cùng hộp thoại đồng ý.

Phần "Xét tốt nghiệp (tham khảo)" của trang `#competency` **không** đọc bản xét tốt nghiệp lưu kèm kết quả đánh giá: nó gọi `GET /api/student/graduation` như trang `#graduation` (đánh giá tính trên server mỗi lần mở trang) và dùng cùng hàm hiển thị (`verdictHeadline`, `suggestionItems`, `criteriaRows` trong `apps/web/src/student-graduation-data.ts`), nên hai màn hình luôn cùng tiêu chí, cùng thứ tự (các nhóm, điểm trung bình, tổng số tín chỉ tích lũy ở cuối), cùng số liệu và cùng lý do chưa đạt. Phần này mở đầu bằng "Căn cứ:" và tên tiêu chuẩn viết đầy đủ (`standardDocumentName`, liên kết sang `#graduation`), rồi câu kết luận kèm nút "Xem chi tiết", danh sách "Nên làm" và bảng tiêu chí. Nhóm tự chọn tốt nghiệp có Đồ án/Khóa luận tốt nghiệp (ví dụ TC306 của K29) được gợi ý theo quy tắc `thesisOption`: đồ án là phương án chính, học phần thay thế chỉ là phương án dự phòng khi sinh viên không làm đồ án theo quy định của Khoa (hoặc là đường tiếp tục nếu đã bắt đầu học phần thay thế). Khi các nhóm chưa đạt đã bù đủ số tín chỉ tích lũy còn thiếu, câu kết luận nói một lần thay vì cộng trùng.

## Kiến trúc: "Hệ thống AI" lai

| Lớp | Vai trò | Vị trí |
|---|---|---|
| Bộ tính điểm dựa trên tri thức | Trọng số học phần → kỹ năng do Khoa cấu hình (AD-COMP). Mọi con số, mức, khoảng trống, gợi ý đều do lớp này tính, thuần và tất định. `graduation.ts` đồng thời là bộ máy xét tốt nghiệp của trang Điều kiện xét tốt nghiệp. | `apps/api/src/competency-assessment/calculate.ts`, `constants.ts`, `course-state.ts`, `plan-progress.ts`, `graduation.ts`, `specialty.ts` |
| Thu thập dữ liệu | Đọc ảnh chụp nhất quán (REPEATABLE READ READ ONLY): hồ sơ, bảng điểm, CTĐT, trọng số, tiêu chuẩn tốt nghiệp (bộ chọn chung với trang Điều kiện xét tốt nghiệp), KHĐT, nghề mục tiêu. | `inputs.ts`, `apps/api/src/graduation/resolve.ts` |
| Lưu trữ và API | Lưu kết quả (tối đa 20 bản/sinh viên), đồng ý, hàng đợi AI. | `repository.ts`, `router.ts`, `ai/queue.ts` |
| LLM cục bộ | `gemma4:e4b` qua Ollama trên máy chạy worker AI (hiện là laptop của nhóm thực hiện đồ án, GPU RTX 3050 4 GB); chỉ diễn giải số liệu đã tính, đầu ra bị ràng buộc bằng JSON schema và kiểm tra lại phía server. | `ai/prompt.ts`, `ai/schema.ts`, `ai/validate.ts`, `ai/worker-router.ts`, `apps/api/src/ai-worker/` |
| Giao diện | Trang `#competency` và `#skill-gap`, hộp thoại đồng ý, trạng thái nhận xét AI, xét tốt nghiệp đọc từ trang `#graduation`. | `apps/web/src/StudentCompetency.tsx`, `student-competency-data.ts`, `student-graduation-data.ts`, `student-graduation-api.ts` |

### Chức năng → thành phần

| Chức năng | Thành phần |
|---|---|
| Suy ra Đạt/Không đạt từ điểm chữ khi cột kết quả trống (A+…D, MT đạt; F không đạt) | `course-state.ts` (API; cũng là nguồn trạng thái học phần của trang Điều kiện xét tốt nghiệp), `apps/web/src/transcript-results.ts` (trang bảng điểm, CTĐT, KHĐT); bảng ca chung `fixtures/result-cases.json` |
| Điểm, độ phủ, độ tin cậy kỹ năng; điểm nhóm; điểm tổng | `calculate.ts` |
| Khoảng trống so với nghề, mức phù hợp, học phần hỗ trợ, tự học | `calculate.ts` |
| Tiến độ theo KHĐT | `plan-progress.ts` |
| Xét tốt nghiệp (cận dưới/cận trên) | `graduation.ts`, dùng chung với trang Điều kiện xét tốt nghiệp qua `apps/api/src/graduation/evaluation.ts`; chọn tiêu chuẩn bằng `apps/api/src/graduation/resolve.ts`; bảng ca `fixtures/graduation-cases.json` |
| Chuyên ngành sinh viên (CNPM/CNDL/TTNT) | migration 028, `PATCH /api/student/profile`, `specialty.ts` |
| Nhận xét AI | `ai/*`, `apps/api/src/ai-worker/*`, `services/ai/` |
| Lời khuyên xét tốt nghiệp (AI, trang `#graduation`) | `apps/api/src/graduation/advice/*`, cùng worker; xem `docs/graduation-advice.md` |

## Công thức và ngưỡng (`CALC_VERSION = "comp-calc-v8"`)

> comp-calc-v2: kỹ năng dưới ngưỡng còn học phần **Học cải thiện** không bị liệt kê là "Không còn học phần nào trong CTĐT để học thêm" (chỉ khi không còn học phần học mới lẫn học cải thiện).
>
> comp-calc-v3: "x/y kỹ năng có minh chứng" của mỗi nhóm (`groups[].skillCount`) dùng cùng quy tắc với dòng tổng (`overall.basis.applicableSkills`): bỏ kỹ năng chỉ thuộc môn điều kiện và kỹ năng "Ngoài lựa chọn học phần của bạn" (`not_applicable`), nên tổng các nhóm bằng dòng tổng. Trang web tự đếm lại từ danh sách kỹ năng nên kết quả lưu trước v3 cũng hiển thị đúng.
>
> comp-calc-v4: điểm tính ra được làm sạch nhiễu số thực trước khi xếp mức (`snapScore`; ví dụ mọi học phần 8,5 điểm từng ra 84,99999999999999, tức "Khá" và chưa đạt Bắt buộc 85), và điểm thang 100 được lưu **làm tròn xuống** 2 chữ số (`floorScore`) thay vì làm tròn thường, nên số nguyên trang hiển thị không bao giờ đạt một mức mà điểm thật chưa đạt (84,996 lưu 84,99, hiển thị 84, thiếu 1).
>
> comp-calc-v5: phần xét tốt nghiệp dùng chung một bộ máy với trang Điều kiện xét tốt nghiệp (E1–E5 ở mục "Xét tốt nghiệp: bộ máy dùng chung" bên dưới), nên số liệu xét tốt nghiệp của kết quả mới có thể khác kết quả v4 của cùng bảng điểm. Điểm kỹ năng, nhóm, tổng và mức phù hợp nghề không đổi.
>
> comp-calc-v6: thêm `skillPlans` — với mỗi kỹ năng có điểm dưới mức Khá (70), không phải môn điều kiện và không phải khoảng trống của nghề mục tiêu (khoảng trống nghề đã có gợi ý riêng), hệ thống liệt kê học phần cụ thể: `take` (học phần áp dụng cho sinh viên, chưa đạt, không thuộc nhóm tự chọn đã chọn đủ; kèm kiểm tra tiên quyết/học trước, học kỳ dự kiến; học phần F là học lại) và `improve` (học phần đã đạt với điểm × 10 dưới 70, để học cải thiện); không còn học phần nào → `selfStudy`. Tối đa 8 kỹ năng (`MAX_SKILL_PLANS`), yếu nhất trước, mỗi danh sách tối đa 5 học phần. Điểm kỹ năng, nhóm, tổng, mức phù hợp và xét tốt nghiệp không đổi.
>
> comp-calc-v7 (góp ý "đã chọn nghề thì phải đề xuất theo nghề"): mỗi kế hoạch có `purpose`. **Đã chọn nghề**: chỉ lập kế hoạch cho kỹ năng **của nghề mục tiêu** đã đạt ngưỡng nhưng chưa tới mức Thành thạo (dưới 85) — `purpose: "deepen"`, nâng kỹ năng nghề lên Thành thạo; kỹ năng yếu ngoài nghề (ví dụ kỹ năng mạng khi nghề là kỹ sư phần mềm) không có kế hoạch, chỉ hiện điểm trong bảng thành thạo; khoảng trống nghề vẫn có gợi ý riêng như trước. **Chưa chọn nghề**: kế hoạch cho kỹ năng dưới Khá như v6 (`purpose: "strengthen"`). **Học phần thay thế đồ án/khóa luận tốt nghiệp** (nhóm tự chọn có học phần tên "Đồ án/Khóa luận tốt nghiệp" đủ hạn mức tín chỉ của nhóm, cùng quy tắc `apps/api/src/graduation/thesis.ts`) không bao giờ được gợi ý ở danh sách học mới — của khoảng trống nghề lẫn kế hoạch — trừ khi sinh viên đã bắt đầu học phần thay thế; mã bị loại ghi ở `excludedThesisReplacements`. Đồ án/khóa luận vẫn được gợi ý nếu có trọng số kỹ năng. Nhóm không xác định được hạn mức (ví dụ chưa chọn chuyên ngành nên chưa có tiêu chuẩn) thì chưa nhận diện được nhóm đồ án.
>
> comp-calc-v8 (STU-COMP-07): thêm `history` — với mỗi học kỳ có điểm trong bảng điểm (cũ nhất trước), hệ thống chạy lại đúng cách tính trên bảng điểm **cắt đến cuối học kỳ đó** (giữ các mục không có năm học/học kỳ như điểm bảo lưu; lần học sau học kỳ đó bị bỏ, nên học phần học lại về sau vẫn tính theo điểm lúc ấy), cùng CTĐT, trọng số và nghề hiện hành, rồi lưu điểm tổng, mức, số kỹ năng có minh chứng và điểm từng nhóm. Điểm cuối cùng trùng với kết quả hiện tại. Không gửi cho mô hình AI (prompt vẫn comp-v5). Trang `#competency` hiển thị thành bảng "Theo dõi năng lực theo học kỳ": câu tóm tắt xu hướng, nhóm theo năm học (điểm cuối năm), mỗi học kỳ có thanh điểm, mức, điểm từng nhóm và thay đổi (số nguyên như trang hiển thị; tăng xanh, giảm đỏ). Kết quả lưu trước v8 không có `history`; trang nhắc bấm "Đánh giá lại".

- `cr` = tín chỉ theo CTĐT, `w` = trọng số kỹ năng trong học phần.
- **Điểm kỹ năng (0–100)** = `10 × Σ(score10 × cr × w) / Σ(cr × w)` trên các học phần có điểm; mỗi học phần lấy lần học được chọn (lần đạt có điểm cao nhất, nên lần F trước đó bị bỏ qua sau khi học lại đạt; lần F chỉ được tính khi học phần chưa từng đạt); MT tính là đã học nhưng không vào trung bình.
- **Độ phủ** dùng cùng tập học phần áp dụng A (học phần chung ∪ chuyên ngành đã chọn ∪ mọi học phần đã học); mẫu số tính theo hạn mức tín chỉ của từng nhóm tự chọn.
- **Mức**: ≥85 Thành thạo, ≥70 Khá, ≥50 Cơ bản, <50 Cần củng cố.
- **Độ tin cậy** = min(dải độ phủ 30%/70%, dải minh chứng Σ cr·w 1,0/2,5).
- **Nhóm và tổng**: loại GDTC/GDQP (môn điều kiện); điểm tổng = trung bình các nhóm có dữ liệu.
- **Nghề**: Ưu tiên ≥70, Bắt buộc ≥85; hệ số 1/2. Điểm từng yêu cầu: đạt = 1; dưới ngưỡng = 0,5 × clamp((điểm − 40)/(ngưỡng − 40), 0, 1); chưa học = 0; "Sắp học" và "Chưa đủ dữ liệu" bị loại. Nhãn: ≥0,80 Phù hợp, ≥0,50 Khá phù hợp, còn lại Cần bổ sung nhiều; phần hệ số có dữ liệu < 50% → Chưa đủ dữ liệu.
- **Kế hoạch học phần** (comp-calc-v7): đã chọn nghề → kỹ năng nghề đã đạt ngưỡng nhưng dưới 85, hiển thị ở trang `#skill-gap` mục "Nâng kỹ năng của nghề lên mức Thành thạo" (hết học phần thì gợi ý một dự án gắn với nghề); chưa chọn nghề → kỹ năng dưới Khá, mục "Kỹ năng cần củng cố (dưới mức Khá)". Mỗi kế hoạch gồm học phần học mới/học lại (có kiểm tra điều kiện đăng ký) và học cải thiện (điểm học phần dưới 70). Trang web bỏ qua kế hoạch v6 (không có `purpose`) khi sinh viên đã chọn nghề.
- Mọi ngưỡng nằm trong `constants.ts`; đổi ngưỡng phải tăng `CALC_VERSION`.

### Chọn phiên bản dữ liệu

- CTĐT: bản đang áp dụng của khóa sinh viên (nhiều bản → `curriculum_ambiguous`).
- Trọng số: revision mới nhất của cùng CTĐT có ít nhất một cấu hình đang áp dụng.
- Tiêu chuẩn tốt nghiệp: bộ chọn chung `apps/api/src/graduation/resolve.ts` (cùng trang Điều kiện xét tốt nghiệp và lời khuyên AI): tiêu chuẩn đang mở của khóa, bản hiện hành, chọn theo chuyên ngành với định danh đầy đủ (chuyên ngành, khối lớp, mã tiêu chuẩn); `gpaScale` mặc định 4. Quy tắc `specialty`/`general`/`specialty_unset`/`not_found`/`ambiguous`: xem `docs/graduation-standards.md`.
- KHĐT: bản gắn với CTĐT, rồi bản cùng định danh; còn lại → ghi là chưa xác định.
- Mỗi kết quả lưu `meta` (phiên bản bảng điểm, CTĐT, trọng số, tiêu chuẩn tốt nghiệp `graduationStandardId`/`RevisionId`/`Version`, `calcVersion`, `promptVersion`). Kết quả không bị xóa theo thời gian; chỉ giữ 20 bản mới nhất mỗi sinh viên.

### Xét tốt nghiệp: bộ máy dùng chung (comp-calc-v5)

`graduation.ts` là bộ máy xét tốt nghiệp duy nhất. `calculate.ts` (đánh giá năng lực) và `apps/api/src/graduation/evaluation.ts` (trang `#graduation`, xem `docs/graduation-standards.md`) cùng gọi `assessGraduationStandard` với đầu vào dựng theo cùng cách (`graduationInputs`: trạng thái học phần từ `course-state.ts`, bản đồ tín chỉ chương trình `programCreditMap`, nhóm tự chọn của CTĐT, môn điều kiện), và cùng chọn tiêu chuẩn bằng `apps/api/src/graduation/resolve.ts`. Với cùng dữ liệu, nhóm, tín chỉ và điểm trung bình ở hai trang là cùng con số (`apps/api/src/graduation/evaluation.test.ts` so trực tiếp với `calculateAssessment`). Bộ máy cũ trên web (`apps/web/src/graduation-assessment.ts`, `graduation-scores.ts`) đã bị xóa. Thay đổi trong comp-calc-v5:

- **E1 Nhãn nhóm.** Tên nhóm trùng nhau (K29 CNDL có hai "Nhóm tự chọn TC102") được ghi thêm số học phần và mã học phần đầu tiên theo thứ tự của tiêu chuẩn, ví dụ "Nhóm tự chọn TC102 · 2 học phần, gồm 71PEKC10062", giống quy tắc của trang web cũ; tên không trùng giữ nguyên. Mỗi nhóm có thêm `code` (mã `TCxxx` đọc từ tên, nếu có) bên cạnh `curriculumElectiveCode`; bản sao kiểu ở web (`apps/web/src/competency-assessment-types.ts`) đã cập nhật.
- **E2 Quy tắc kết luận.** Không có yêu cầu → Chưa xác định; cận dưới + 1e-9 ≥ yêu cầu → Đạt, kể cả khi cận trên chưa tính được (ví dụ một học phần chưa rõ kết quả cũng chưa rõ số tín chỉ); cận trên + 1e-9 < yêu cầu → Chưa đạt; còn lại Chưa xác định. Trước v5, thiếu cận dưới hoặc cận trên đều ra Chưa xác định.
- **E3 Tín chỉ học phần.** Tín chỉ trong tiêu chuẩn → tín chỉ CTĐT → tín chỉ của lần học được chọn trên bảng điểm (nếu > 0) → chưa rõ. Trước v5 không lấy tín chỉ từ bảng điểm.
- **E4 Ước tính tín chỉ tích lũy** (khi bảng điểm không in tổng). Cộng tín chỉ các học phần Đạt/MT thuộc **chương trình** = học phần của tiêu chuẩn ∪ học phần CTĐT (tín chỉ theo tiêu chuẩn, rồi CTĐT, rồi bảng điểm), bỏ môn điều kiện và học phần có lần học đánh dấu điều kiện; cận trên cộng thêm học phần có điểm nhưng chưa rõ kết quả. Học phần ngoài chương trình (AV0, học phần bảo lưu của chương trình khác) vẫn không được cộng, giống tổng in trên bảng điểm. Trước v5 chỉ cộng học phần CTĐT; nếu trang tốt nghiệp dùng quy tắc đó, các khóa chưa có CTĐT (K26–K28) sẽ ước tính 0 tín chỉ và bị báo Chưa đạt sai.
- **E5 Tổng tín chỉ in trên bảng điểm.** Vẫn đọc ở học kỳ có điểm gần nhất, nay nhận cả "Tổng số tín chỉ tích lũy" lẫn "Số tín chỉ tích lũy" (kể cả "TC", "đã tích lũy" và khoảng trắng bị OCR làm mất) theo nhãn của cả hai bộ đọc (`transcript-parser.ts`, `ocr-adapter.ts`), không bao giờ nhận dòng theo học kỳ ("… đạt học kỳ", "… đăng ký"). Giá trị không đọc được hoặc mâu thuẫn → dùng số ước tính (nguồn `calculated`; trang tốt nghiệp thêm cảnh báo `printed_credits_unreadable`) thay vì Chưa xác định như trước.
- Không đổi: điểm trung bình tích lũy, trạng thái lần học, quy tắc môn điều kiện, F rồi đăng ký lại là đang học, nhóm bắt buộc tính theo số môn kể cả môn (*). Kiểm tra chéo tín chỉ của đánh giá năng lực (`creditCrossCheck`) vẫn so khớp đúng bằng với tín chỉ CTĐT đã đạt (đọc tổng in theo nhãn mới của E5); trang tốt nghiệp dùng quy tắc khoảng [cận dưới, cận trên] của ước tính E4.

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

Xóa hoặc thay bảng điểm (kể cả qua OCR) xóa toàn bộ kết quả đánh giá của sinh viên trong cùng giao dịch, cùng với lời khuyên xét tốt nghiệp (`stu_grad_advice`, xem `docs/graduation-advice.md`).

## AI 100% (`comp-ai-v1`, Claude Haiku 5.5)

Bật khi server có `ANTHROPIC_API_KEY` (tùy chọn thêm `ANTHROPIC_WORKSPACE_ID` cho key không gắn workspace `sk-ant-usr-…`, `ANTHROPIC_MODEL` mặc định `claude-haiku-5-5`, `ANTHROPIC_EFFORT` mặc định `high`). Không có key thì mọi thứ như trước (máy AI trên laptop viết nhận xét, hoặc tắt AI). Chính sách 2026-10-16 công bố việc gửi dữ liệu cho Anthropic; đồng ý là bắt buộc để dùng hai trang. Lời khuyên xét tốt nghiệp và đề xuất kỹ năng cho nghề vẫn chạy trên laptop.

- **Hàng đợi** (`ai-cloud/queue.ts`): cùng hook và luật của `ai/queue.ts` (khóa advisory, một job chờ mỗi sinh viên, trần 25 job), nhưng job mang `runner='cloud'` (migration 033) và `ai_input` là prompt tính điểm; kết quả đánh dấu `scoring_mode='ai'`. Worker trên laptop chỉ nhận `runner='worker'`.
- **Bộ chạy** (`ai-cloud/runner.ts`): chạy ngay trong API server, mỗi lần một job, lease 30 phút, tối đa 2 lần nhận như worker. Bước 1 gọi Claude tính điểm (`ai-cloud/scoring-prompt.ts`: khối dữ liệu gồm học phần CTĐT, mọi lần học trong bảng điểm, nhóm, kỹ năng với học phần và trọng số liên kết, yêu cầu nghề khóa Y1, Y2…; prompt ghi đủ công thức 7 bước). Bước 2 ghép số của AI vào kết quả (`ai-cloud/merge.ts`) rồi gọi Claude viết nhận xét bằng prompt `comp-v5` trên kết quả đã ghép, kèm một dòng nhắc độ dài. Cả hai bước dùng structured outputs (`output_config.format` = JSON schema đã làm sạch: bỏ `maxLength`/`maxItems`/…, đóng mọi object), stream, không gửi `thinking` hay `temperature`; câu trả lời không hợp lệ được hỏi lại một lần. `prompt_version` = `comp-ai-v1+comp-v5`.
- **Kiểm tra** (`ai-cloud/scoring-validate.ts`): mỗi khóa đúng một lần, điểm 0–100, và câu trả lời tự nhất quán (trạng thái và mức thiếu của từng yêu cầu nghề khớp điểm kỹ năng AI tự cho, điểm tổng bằng trung bình các nhóm, sai số 0,05). Không tính lại điểm từ dữ liệu. Nhận xét qua `validateAiOutput` với giới hạn độ dài ×1,5 (Claude không nhận `maxLength`).
- **Ghép** (`mergeAiScoring`): điểm kỹ năng, nhóm, tổng và trạng thái, mức thiếu, mức phù hợp nghề lấy của AI; mức và nhãn suy từ điểm AI theo ngưỡng của hệ thống; xếp hạng, đếm, điểm mạnh và lựa chọn cho prompt tính lại trên điểm AI; độ tin cậy, độ phủ, chỉ số phù hợp bị xóa (AI không tính). Kế hoạch học phần giữ danh sách của hệ thống nhưng chỉ còn khi điểm AI vẫn cần. Lịch sử theo học kỳ, tiến độ KHĐT, xét tốt nghiệp, dữ kiện học phần và cảnh báo vẫn của hệ thống.
- **API**: `StoredAssessment` thêm `scoring` (`system`/`ai`) và `aiResult` (kết quả đã ghép, `null` tới khi chấm xong); `GET /latest` thêm `aiMode` (`cloud`/`worker`/`disabled`). Ở chế độ cloud, `POST /:id/ai` đọc lại dữ liệu (409 `transcript_changed` nếu bảng điểm đổi, 409 `assessment_outdated` nếu CTĐT/trọng số cho ra bộ kỹ năng khác) và còn cho tạo lại một kết quả `completed` mà nhận xét lỗi.
- **Đo** (16/10/2026, dữ liệu chương trình K29 thật – 88 học phần, 81 kỹ năng – với bảng điểm giả lập): effort `high` → hồ sơ 1 sai 1/81 kỹ năng (lệch 2,8, cùng mức), 3/3 nhóm và điểm tổng đúng; hồ sơ 2 đúng hết; 116–130 giây, khoảng 13 nghìn token vào và 37–42 nghìn token ra (khoảng 0,02 USD). Effort `medium`: 81/81 kỹ năng nhưng lệch nhẹ 1 nhóm mỗi hồ sơ. Cùng bài thử: gemma4:e4b đúng 3/162 điểm kỹ năng, gemma-4-31b-it đúng 153/162 nhưng sai điểm nhóm và điểm tổng. Một job đầy đủ trên hồ sơ tổng hợp (`fixtures/synthetic-k29`): 62 giây, điểm khớp hoàn toàn, nhận xét qua kiểm tra ngay lần đầu.

## Nhận xét AI

- Server bật hàng đợi khi có `AI_WORKER_KEY` (≥ 32 ký tự, khác `OCR_WORKER_KEY`) trong `apps/api/.env` hoặc trên Render.
- Mỗi sinh viên có tối đa một job đang chờ; bản mới hủy job cũ. Quá 25 job chờ toàn hệ thống → `deferred`.
- Prompt hiện tại là `comp-v5` (`PROMPT_VERSION` trong `ai/prompt.ts`); kết quả lưu trước đó có thể mang `comp-v4`, `comp-v3` hoặc `comp-v2`. Các mục dưới đây mô tả những gì từng bản đưa vào (vẫn giữ nguyên ở bản sau).
- `comp-v2` (bản trước, các quy tắc vẫn áp dụng): system prompt cố định + khối dữ liệu đã làm sạch (bỏ token đặc biệt Gemma, ký tự điều khiển). Schema JSON được dựng riêng cho từng job: enum nhóm; enum **điểm mạnh** (kỹ năng mức Khá trở lên, không dưới ngưỡng nghề) tách khỏi enum **cần cải thiện** (dưới Khá hoặc dưới ngưỡng nghề); mã học phần theo từng kỹ năng khoảng trống. Khối dữ liệu chỉ ghi học phần đã học là "minh chứng" (đang học / sắp học ghi riêng), không gửi chỉ số phù hợp dạng số. Validator từ chối mã học phần trong văn bản không có trong khối dữ liệu (`foreign_course`) và kỹ năng vừa là điểm mạnh vừa cần cải thiện/khoảng trống (`conflicting_skill`); trang web còn thay khóa S…/G… lọt vào văn bản bằng tên.
- `comp-v3` (bản hiện tại) thêm: khối dữ liệu ghi số **đúng như trang hiển thị** — điểm thang 100 (tổng, nhóm, kỹ năng, ngưỡng và điểm của yêu cầu nghề) là số nguyên làm tròn xuống như `formatScore`, mức thiếu làm tròn lên (tối thiểu 1) như `deficitPoints`, độ phủ là phần trăm nguyên, điểm học phần/tín chỉ/điểm trung bình tích lũy tối đa 2 chữ số thập phân. Validator lấy tập số cho phép từ khối dữ liệu nên "83,92" bị từ chối (`invented_number`). Học kỳ ghi bằng chữ ("học kỳ 3 năm học 2025–2026", từ mã HKyyS: yy = năm bắt đầu % 100, S = học kỳ); nếu mô hình vẫn viết mã của một học kỳ có trong dữ liệu (HK253) thì vẫn chấp nhận, mã bịa (HK271) bị từ chối. Prompt giải thích priority: high = "Cần làm sớm", medium = "Nên làm", low = "Có thể để sau" (nhãn trên trang; tránh trùng với tính chất "Ưu tiên" của yêu cầu nghề).
- `comp-v4` (bản hiện tại, theo góp ý "kết quả AI chưa nói sinh viên cần học môn gì" và "nhận xét còn chung chung"): mỗi mục `improvements` có thêm `courses` (tối đa 2 `{ courseCode, reason }`, đứng trước `comment` trong schema để mô hình chọn học phần trước rồi mới viết), mã học phần chỉ được lấy từ danh sách của đúng kỹ năng đó (kế hoạch `skillPlans` của kỹ năng, rồi học phần của khoảng trống nghề) — schema dựng nhánh `anyOf` theo từng kỹ năng, validator từ chối học phần của kỹ năng khác. Với kết quả comp-calc-v6, chỉ kỹ năng có kế hoạch học phần hoặc dưới ngưỡng nghề mới được nêu là cần cải thiện, nên mỗi mục luôn có học phần để nêu (hoặc thật sự không có, khi đó gợi ý tự học kèm sản phẩm kiểm chứng). Khối dữ liệu: mục [6] mới "Kỹ năng cần cải thiện" liệt kê học phần bằng lời (chưa học / chưa đạt – cần học lại / đang học / đã đạt, điểm 6,5 (C+) – có thể học cải thiện; đủ điều kiện đăng ký hoặc "cần đạt trước …"; học kỳ dự kiến); mục [3] gửi thêm các kỹ năng có kế hoạch và 1–2 kỹ năng thấp nhất của mỗi nhóm dưới Khá, mục [2] ghi "kỹ năng thấp nhất của nhóm"; **bỏ hẳn mục xét tốt nghiệp** (trang `#competency` hiển thị xét tốt nghiệp từ trang `#graduation`, có lời khuyên AI riêng), `progress` chỉ nói về tiến độ so với KHĐT (mục [8]). System prompt thêm quy tắc 9–13: không viết câu chung chung ("nền tảng yếu", "cần tập trung"…) mà không kèm việc cụ thể; mỗi mục cần cải thiện và mỗi bước tiếp theo phải nêu tên học phần (học mới, học lại, học cải thiện hoặc ôn lại) của đúng kỹ năng, chỉ gợi ý tự học khi không có học phần; học phần chưa đủ điều kiện phải nói cần đạt học phần tiên quyết nào trước; nhóm dưới Khá phải nêu kỹ năng thấp nhất và học phần nên làm; không nhận xét về xét tốt nghiệp. Nhận xét lưu trước comp-v4 không có `courses` (trang web coi là rỗng); job comp-v3 đang chờ vẫn hoàn tất với schema cũ.
- `comp-v5` (bản hiện tại): khi sinh viên đã chọn nghề, danh sách "cần cải thiện" chỉ gồm kỹ năng của nghề dưới ngưỡng và kỹ năng nghề có kế hoạch nâng lên Thành thạo; kỹ năng yếu ngoài nghề không bao giờ được khuyên học lại/học cải thiện/ôn lại (nhận xét theo nhóm chỉ nói đó là kỹ năng ngoài yêu cầu của nghề). Mục [2] và [3] ghi mỗi kỹ năng "thuộc / ngoài nghề mục tiêu"; mục [6] ghi mục đích của từng kỹ năng (dưới ngưỡng nghề, đã đạt ngưỡng và có thể nâng lên Thành thạo, hoặc dưới Khá khi chưa chọn nghề); kỹ năng nghề không còn học phần → gợi ý một sản phẩm/dự án gắn với nghề. Điểm mạnh ưu tiên kỹ năng của nghề; kỹ năng đang có kế hoạch nâng không được nêu là điểm mạnh (validator từ chối kỹ năng nằm ở cả hai danh sách). Chưa chọn nghề: như comp-v4. Kiểm tra với gemma4:e4b trên dữ liệu tổng hợp (14/10/2026, `num_gpu` 24 vì GPU đang bận): 2/2 hợp lệ, khoảng 70 giây mỗi lần.
- Trước khi lưu `ai_output`, server (`ai/key-cleanup.ts`) gỡ khóa S…/G… khỏi văn bản: khóa đứng cạnh chính tên của nó bị bỏ cùng dấu nối ("API (S12)" → "API", "(API - S12)" → "(API)", "S12 - API" → "API"), khóa trong ngoặc ở chỗ khác bị bỏ, khóa trần được thay bằng tên. Trang web chạy cùng quy tắc (`cleanKeyText`) cho các nhận xét lưu trước comp-v3.
- Server kiểm tra lại đầu ra: schema Zod strict, danh sách khóa và mã cho phép, không URL/email/HTML, mọi con số trong văn bản phải có trong khối dữ liệu. Sai → `invalid_ai_output`, không hiển thị.

### Giao thức worker (`/api/worker/competency-assessments`)

Xác thực `Authorization: Bearer <AI_WORKER_KEY>` (SHA-256 + `timingSafeEqual`) trước khi đọc body; body tối đa 512 kB.

- `POST /heartbeat`, `POST /claim` (job cũ nhất, `FOR UPDATE SKIP LOCKED`, lease 15 phút, tối đa 2 lần thử), `POST /:id/extend`, `POST /:id/complete` (idempotent theo lease).
- Loại job: worker gửi `{ kinds: [...] }` trong `/heartbeat` và `/claim` (lưu ở `stu_comp_ai_worker_status.kinds`); job trả về có `kind`. Có ba loại (`AI_JOB_KINDS` trong `ai/worker-protocol.ts`): `competency_assessment` là nhận xét năng lực; `career_skill_suggestion` là đề xuất kỹ năng cho vị trí nghề nghiệp (xem `docs/career-ai-suggestions.md`); `graduation_advice` là lời khuyên xét tốt nghiệp cho sinh viên (xem `docs/graduation-advice.md`).
- `/claim` thử theo thứ tự **đề xuất kỹ năng → lời khuyên tốt nghiệp → nhận xét năng lực**, mỗi loại chỉ khi worker có báo loại đó. Worker cũ không gửi `kinds` nên chỉ nhận job nhận xét năng lực; worker phát hành trước lời khuyên tốt nghiệp không báo `graduation_advice` nên không bao giờ nhận job đó. `/:id/extend` và `/:id/complete` tìm id lần lượt ở bảng nhận xét năng lực, `career_ai_suggestions` rồi `stu_grad_advice`.
- Dọn dẹp tối đa mỗi 60 giây, chạy cả từ `/claim` của worker lẫn từ API sinh viên (`GET /latest`, `GET /latest/status`, khi xếp job mới) nên vẫn chạy khi worker offline: job đang xử lý hết lease sau lần thử cuối, hoặc job (đang chờ / đang xử lý đã hết lease) quá 24 giờ → `failed` với `worker_timeout` và xóa `ai_input`; xóa job đã kết thúc quá 7 ngày. Không bao giờ xóa kết quả đánh giá. `/claim` còn chạy bước dọn dẹp riêng (cùng nhịp 60 giây) của job đề xuất kỹ năng và lời khuyên tốt nghiệp.
- Worker chỉ báo những loại job có trong mã nguồn lúc nó khởi động, nên **sau khi cập nhật mã nguồn phải khởi động lại worker** để nó nhận các loại mới.

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

- Unit: `apps/api/src/competency-assessment/**/*.test.ts`, `apps/api/src/ai-worker/*.test.ts`, `apps/web/src/student-competency-data.test.ts`, `StudentCompetency.test.tsx`; fixture tổng hợp `fixtures/synthetic-k29.ts`. `apps/api/src/graduation/evaluation.test.ts` kiểm tra trang Điều kiện xét tốt nghiệp ra cùng số liệu xét tốt nghiệp với `calculateAssessment`.
- Tích hợp trên DB local (schema tạm, tự xóa): `npm run build -w @edupath/api && node scripts/verify-competency-assessment.mjs [--with-ollama]`.

## Giới hạn hiện tại

- Chỉ K29 có trọng số kỹ năng.
- Khoảng 30 kỹ năng nghề chưa có học phần đo (hiện là "Chưa đủ dữ liệu").
- Chưa có yêu cầu nghề nào được đánh dấu "Bắt buộc".
- STU-COMP-07 tính lại theo bảng điểm nên phản ánh năng lực tại từng học kỳ theo **trọng số và CTĐT hiện hành**, không phải điểm đã từng hiển thị lúc đó. STU-GAP-07 (theo dõi mức cải thiện từng kỹ năng) chưa làm.
- Kết quả và nhận xét lưu trước comp-calc-v7/comp-v5 giữ nguyên cho đến khi sinh viên bấm "Đánh giá lại".
- AI 100%: các con số do Claude tính nên có thể lệch so với công thức; server chỉ kiểm tra định dạng và tính tự nhất quán. Mỗi lần đánh giá mất khoảng 1–3 phút và phụ thuộc dịch vụ của Anthropic; khi API lỗi, trang báo lỗi và sinh viên thử lại.

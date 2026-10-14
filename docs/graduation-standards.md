# Quản lý tiêu chuẩn xét tốt nghiệp — AD-GRAD-01..05

Vào **Quản trị → Tốt nghiệp** (`/quantri/tieu-chuan-tot-nghiep`). Quản trị viên, Ban chủ nhiệm khoa, trưởng/phó bộ môn và giảng viên đều được import, thêm/sửa/xóa dữ liệu, mở/khóa và xem danh sách, chi tiết, lịch sử, nguồn. Chỉ Quản trị viên được phân quyền tài khoản.

## Import biểu mẫu

Chọn `.xls`, `.xlsx` hoặc ZIP chứa các biểu mẫu; tối đa 5 MB. Bấm **Đọc và xem trước**, kiểm tra từng sheet, chọn tiêu chuẩn cần lưu rồi xác nhận. ZIP được đọc trong bộ nhớ, không giải nén ra đường dẫn trên máy chủ. Tên tệp không quyết định cấu trúc dữ liệu.

Nguồn `OneDrive_2026-09-22.zip` có 9 workbook, 15 sheet tiêu chuẩn K26–K29. K27/K29 có nhiều sheet chuyên ngành. Hai bản K28 không chuyên ngành và hai bản K26 có cùng mã tiêu chuẩn/khối lớp: không tự quyết định bản nào là bản chính thức. Chỉ chọn một bản của mỗi tiêu chuẩn khi import mới; muốn áp dụng bản điều chỉnh, dùng **Cập nhật từ Excel** trên bản ghi hiện có. Cả lô được lưu trong một transaction; nếu có bản trùng, không lưu dở dang một phần.

Khóa nhận diện là **mã tiêu chuẩn + khối lớp** lấy từ nội dung sheet. Các chuyên ngành được giữ riêng. Cập nhật từ Excel yêu cầu cùng mã, khối lớp và khóa tuyển sinh. Tệp gốc, sheet, người thao tác và lịch sử phiên bản được giữ lại; không ghi đè lịch sử.

## Dữ liệu được ánh xạ

- Ngưỡng tín chỉ tích lũy, tín chỉ bắt buộc, tín chỉ nhóm tự chọn, tín chỉ tự chọn tự do và điểm trung bình tích lũy tối thiểu.
- Từng nhóm bắt buộc/tự chọn với ngưỡng tín chỉ riêng; hai nhóm cùng nhãn `TC102` vẫn có định danh riêng theo dòng nguồn.
- Mã, tên, tín chỉ và cờ môn điều kiện của từng môn. Mã môn K26 như `DIT0010` được giữ nguyên.
- Môn có dấu `(*)` mang cờ `conditionOnly`: không tính tín chỉ tích lũy/GPA theo ghi chú biểu mẫu. Tín chỉ của môn vẫn được giữ, vì nhóm điều kiện có thể yêu cầu đủ số tín chỉ riêng.
- Tín chỉ trống (ví dụ một số môn quốc phòng K27) được lưu `null`, không biến thành 0. Điểm trung bình giữ đúng ngưỡng trong nguồn.
- **Mặc định đối chiếu theo hệ 4**, gồm tiêu chuẩn cũ chưa có thang điểm và file import không ghi rõ hệ điểm. Quản trị viên vẫn có thể chọn **Hệ 10** cho từng tiêu chuẩn; lựa chọn đã lưu được giữ nguyên. Form sửa thông tin chọn sẵn hệ 4, cùng ngưỡng điểm tối thiểu; hệ 4 không nhận ngưỡng lớn hơn 4. Import giữ hệ 10 khi nhãn nguồn ghi rõ. Thang điểm lưu trong JSON phiên bản và hiển thị ở cổng sinh viên, không cần đổi schema database.
- Bỏ qua cột “đã pass”, dấu đánh dấu và kết quả tính cá nhân ở bên phải. File K26 có tên người học vẫn chỉ cung cấp bộ tiêu chuẩn; không import kết quả của người đó vào hồ sơ sinh viên.

Nội dung ghi chú được giữ làm văn bản. Tệp tải xuống là Excel/ZIP nguồn, chưa bao gồm chỉnh sửa trực tiếp sau import.

## Trang Điều kiện xét tốt nghiệp của sinh viên

Cổng sinh viên → menu tài khoản → **Điều kiện xét tốt nghiệp** (`/dashboard#graduation`). Sinh viên chỉ thấy tiêu chuẩn của chính mình: combobox "Tiêu chuẩn đang áp dụng" đã bỏ, server không còn trả danh sách tiêu chuẩn và `GET /api/student/graduation/:id` đã bị xóa, nên không có cách đọc tiêu chuẩn của khóa hay chuyên ngành khác. Kết luận do server tính; trang web (`apps/web/src/StudentGraduation.tsx`, hàm thuần trong `student-graduation-data.ts`, bản sao kiểu trong `student-graduation-types.ts`) chỉ hiển thị, không tính lại. Bộ máy cũ trên web (`graduation-assessment.ts`, `graduation-scores.ts`) đã bị xóa.

### Chọn tiêu chuẩn của sinh viên

`apps/api/src/graduation/resolve.ts` là nơi duy nhất chọn tiêu chuẩn cho một sinh viên; trang này, đánh giá năng lực (`competency-assessment/inputs.ts`) và lời khuyên AI (`docs/graduation-advice.md`) dùng chung.

- **Khóa** lấy từ tài khoản: `student_profiles.cohort_code` (tách từ tên tài khoản Microsoft, xem `docs/STUDENT_IDENTITY_FIELDS.md`), cắt khoảng trắng hai đầu và viết hoa như cách tiêu chuẩn lưu. Sinh viên không tự sửa được khóa.
- **Chuyên ngành** lấy từ hồ sơ: `student_profiles.specialty` do sinh viên tự khai (CNPM, CNDL, TTNT; giá trị khác là Chưa xác định). Chưa có nguồn chính thức cho chuyên ngành, nên trang ghi rõ tiêu chuẩn được chọn theo "khóa trong tài khoản và chuyên ngành trong hồ sơ" và có liên kết cập nhật chuyên ngành.
- Ứng viên: chỉ các tiêu chuẩn **đang mở** (`is_active`) của đúng khóa đó, bản hiện hành. Tiêu chuẩn thuộc một chuyên ngành khi chuyên ngành, khối lớp hoặc mã tiêu chuẩn của nó chứa mã chương trình (7480201-03 CNPM, 7480201-02 CNDL, 7480201-04 TTNT); không chứa mã chương trình nào là tiêu chuẩn chung. Không bao giờ lấy tiêu chuẩn của chuyên ngành khác. Thiếu `gpaScale` thì đọc là hệ 4.

| `resolution` | Khi nào | Trang hiển thị |
|---|---|---|
| `specialty` | Có chuyên ngành và đúng một tiêu chuẩn của chuyên ngành đó | Tiêu chuẩn đó |
| `general` | Không có tiêu chuẩn riêng của chuyên ngành (hoặc chưa chọn chuyên ngành) và khóa có đúng một tiêu chuẩn chung | Tiêu chuẩn chung của khóa |
| `specialty_unset` | Chưa chọn chuyên ngành, khóa không có tiêu chuẩn chung nhưng có tiêu chuẩn theo chuyên ngành (như K29) | Nhắc chọn chuyên ngành trong hồ sơ, kèm gợi ý nếu có |
| `not_found` | Không có tiêu chuẩn đang mở nào phù hợp | Khoa chưa công bố tiêu chuẩn đang áp dụng cho khóa (và chuyên ngành) |
| `ambiguous` | Nhiều tiêu chuẩn cùng phù hợp, ví dụ hai tiêu chuẩn chung đang mở của cùng khóa | Có nhiều tiêu chuẩn cùng phù hợp, Khoa sẽ rà soát |
| `cohort_unknown` | Hồ sơ chưa có khóa (chỉ có ở trang này; đánh giá năng lực báo lỗi `cohort_unknown`) | Hồ sơ chưa có khóa học, liên hệ Khoa |

Gợi ý chuyên ngành (`specialtySuggestion`) chỉ có khi `specialty_unset`, đã có bảng điểm và khóa có đúng một CTĐT đang áp dụng: đó là chuyên ngành duy nhất có học phần bắt buộc chuyên ngành mà sinh viên đã đạt (cùng quy tắc với đánh giá năng lực). Khi không chọn được tiêu chuẩn, trang không hiện tiêu chuẩn nào khác và không có hai cụm kết quả bên dưới.

### API `GET /api/student/graduation`

Router chỉ đọc `apps/api/src/graduation/student-router.ts`. Dữ liệu được đọc bằng `loadStudentGraduation` (`student-graduation.ts`) trong một giao dịch `REPEATABLE READ READ ONLY`: hồ sơ (chỉ khóa và chuyên ngành), tiêu chuẩn đã chọn, bảng điểm (`student_transcripts`) và học phần của CTĐT đang áp dụng của khóa nếu có đúng một bản. Thiếu hoặc có nhiều CTĐT thì bỏ qua CTĐT; kết quả khi đó chỉ dựa vào tiêu chuẩn.

```ts
{
  profile: { cohortCode: string | null; specialty: "CNPM" | "CNDL" | "TTNT" | null };
  resolution: "specialty" | "general" | "specialty_unset" | "not_found" | "ambiguous" | "cohort_unknown";
  standard: null | {
    id; revisionId; version; name; cohortCode; classBlock; major; specialty; educationSystem; faculty;
    minimumCredits; mandatoryCredits; electiveCredits; freeElectiveCredits; minimumGpa;
    gpaScale;                                    // 4 khi tiêu chuẩn chưa ghi
    notes;
    groups: { id; name; kind; minimumCredits }[];
    courses: { id; groupId; code; name; credits; conditionOnly }[];
  };
  transcript: null | { version: string; updatedAt: string };
  evaluation: null | GraduationEvaluation;       // null khi chưa có tiêu chuẩn hoặc bảng điểm
  specialtySuggestion: null | { code; label; count };
}
```

`standard` chỉ gồm các điều kiện sinh viên cần; chi tiết workbook nguồn và ghi chú rà soát ở lại cổng quản trị. Cần đăng nhập (401 `authentication_required`); `Cache-Control: no-store`; không có database → 503 `database_required`; tài khoản không hoạt động → 403 `account_unavailable`; mọi lệnh khác GET/HEAD → 405 `read_only` (header `Allow: GET, HEAD`); có query string → 400 `invalid_graduation_query`. Đường dẫn `/:id` cũ trả 404.

### Kết quả đối chiếu tính trên server

`evaluateGraduation` (`apps/api/src/graduation/evaluation.ts`, hàm thuần) dựng `evaluation` từ cùng lõi với đánh giá năng lực (`assessGraduationStandard` trong `apps/api/src/competency-assessment/graduation.ts`, `CALC_VERSION = "comp-calc-v6"`; bộ máy xét tốt nghiệp không đổi từ comp-calc-v5, xem `docs/competency-assessment.md`), nên với cùng dữ liệu, số liệu nhóm, tín chỉ và điểm trung bình ở hai trang là một.

- **Trạng thái học phần** (`course-state.ts`): có lần MT → miễn thi (tính là đạt); có lần đạt → đạt; có điểm nhưng không đọc được kết quả → chưa rõ kết quả; có lần đăng ký chưa có điểm → đang học (kể cả sau một lần F); còn lại → chưa đạt; không có trên bảng điểm → chưa học. Ô Kết quả in trên bảng điểm luôn được ưu tiên; ô trống thì A+…D là đạt, F là chưa đạt và được ghi "suy ra từ điểm chữ".
- **Nhóm** (theo thứ tự của tiêu chuẩn, nhận diện bằng học phần thành viên, không bằng tên): nhóm bắt buộc tính theo số môn, yêu cầu là số học phần của nhóm kể cả môn (*); nhóm tự chọn tính theo tín chỉ, yêu cầu là tín chỉ tối thiểu của nhóm. Cận dưới là học phần đạt hoặc MT, cận trên cộng thêm học phần chưa rõ kết quả. **Đạt** khi cận dưới đủ yêu cầu (kể cả khi cận trên chưa tính được), **Chưa đạt** khi cận trên vẫn thiếu, còn lại **Chưa xác định**; không có yêu cầu cũng là Chưa xác định. Khi nhóm chưa Đạt, `remaining` = max(0, yêu cầu − cận dưới). Tên nhóm trùng nhau được ghi thêm số học phần và mã học phần đầu tiên (`<tên> · n học phần, gồm <mã đầu tiên>`); mỗi nhóm có `code` (mã TCxxx trong tên) và `curriculumElectiveCode` (nhóm tự chọn CTĐT có cùng học phần, ví dụ TC306 ≡ TC406). Tiêu chuẩn có mã học phần trùng hoặc thiếu → mọi nhóm Chưa xác định, kèm cảnh báo `standard_ambiguous_codes`.
- **Tín chỉ của học phần**: theo tiêu chuẩn → theo CTĐT → tín chỉ của lần học được chọn trên bảng điểm → chưa rõ.
- **Tín chỉ tích lũy** (`credits`, `null` khi tiêu chuẩn không có ngưỡng): dòng "Tổng số tín chỉ tích lũy" (hoặc "Số tín chỉ tích lũy") in ở học kỳ có điểm gần nhất (`source: "printed"`). Không có dòng đó → ước tính (`"calculated"`) từ các học phần đạt thuộc chương trình (tiêu chuẩn ∪ CTĐT), mỗi mã một lần, không tính môn điều kiện; cận trên cộng thêm học phần chưa rõ kết quả. Dòng in không đọc được hoặc mâu thuẫn → dùng số ước tính và cảnh báo `printed_credits_unreadable`. `creditCheck` so tổng in với khoảng ước tính: `match` khi tổng in nằm trong [cận dưới, cận trên] (dung sai 1e-6), `mismatch` (kèm cảnh báo `credits_mismatch`), `unavailable` khi không có tổng in đọc được.
- **Danh sách phụ**: `improvementCandidates` (tối đa 8, xem bên dưới), `inProgress` và `unknownResults` (học phần của tiêu chuẩn đang học hoặc chưa rõ kết quả, mỗi danh sách tối đa 20).
- **Cảnh báo**: `results_inferred` (số học phần của tiêu chuẩn có kết quả suy ra từ điểm chữ), `credits_mismatch`, `printed_credits_unreadable`, `ocr_needs_review`, `standard_ambiguous_codes`.
- **Kết luận chung** (`status`): có điều kiện Chưa đạt → `fail`; không có nhưng có điều kiện Chưa xác định → `unknown`; còn lại `pass`. `groupStatus` là kết luận riêng của các nhóm; `asOf` ghi phiên bản bảng điểm, ngày cập nhật và học kỳ có điểm gần nhất.

### Bố cục trang

Màu trạng thái: xanh lá = đạt, đỏ = chưa đạt, hổ phách = chưa xác định, xanh dương = đề xuất và lời khuyên AI. Trạng thái luôn có ký hiệu (✓, ✗, ?, →) và chữ, không chỉ dựa vào màu.

1. **Tiêu chuẩn xét tốt nghiệp của bạn**: tên tiêu chuẩn; dòng khóa, chuyên ngành (hoặc "Tiêu chuẩn chung của khóa") và phiên bản; năm ngưỡng (tín chỉ tích lũy tối thiểu, tín chỉ bắt buộc, tín chỉ nhóm tự chọn, tín chỉ tự chọn tự do, điểm trung bình tích lũy tối thiểu kèm thang); ghi chú của tiêu chuẩn; câu "Tiêu chuẩn được chọn tự động theo khóa trong tài khoản và chuyên ngành trong hồ sơ của bạn." với liên kết **Cập nhật chuyên ngành** (`#profile`). Không có combobox. Khi chưa chọn được tiêu chuẩn, cụm này chỉ hiện thông báo theo `resolution` ở bảng trên.
2. **Kết quả xét tốt nghiệp tính đến thời điểm hiện tại**: dòng thời điểm (ngày cập nhật bảng điểm, học kỳ có kết quả gần nhất viết bằng chữ); banner kết luận: xanh lá "Đủ các điều kiện xét tốt nghiệp theo tiêu chuẩn của khóa (tham khảo).", đỏ "Chưa đủ điều kiện xét tốt nghiệp vì thiếu …" liệt kê từng phần chưa đạt với mức thiếu, hổ phách "Chưa đủ dữ liệu để kết luận …". Tiếp theo là các danh sách **Đã đạt** (xanh lá), **Chưa đạt** (đỏ, mỗi điều kiện kèm "còn thiếu …"), **Chưa xác định** (hổ phách, chỉ khi có) và **Đề xuất điều cần làm** (xanh dương). Đề xuất do code tính và luôn hiển thị: mỗi nhóm bắt buộc chưa đạt liệt kê học phần còn thiếu kèm trạng thái; mỗi nhóm tự chọn chưa đạt ghi "Chọn học thêm ít nhất N tín chỉ trong nhóm …" kèm các học phần chưa đạt của nhóm (chỉ cần đủ tín chỉ, không phải học hết); thiếu tín chỉ tích lũy; điểm trung bình chưa đạt kèm học phần nên học cải thiện hoặc học lại; học phần đang học; học phần chưa rõ kết quả. Sau đó là các lưu ý dữ liệu (kết quả suy ra từ điểm chữ, tổng tín chỉ chưa khớp, OCR cần kiểm tra…), phần "Cách đối chiếu", khung **Lời khuyên từ EduPath AI** (`docs/graduation-advice.md`) và câu "Kết quả xét tốt nghiệp chính thức do nhà trường công bố." Chưa có bảng điểm thì cụm này nhắc import bảng điểm.
3. **Đối chiếu chi tiết** với hai tab (nút có `aria-pressed`, mặc định là tab nhóm): **Đối chiếu theo nhóm kiến thức** (bảng Nhóm | Đã có | Yêu cầu | Còn thiếu | Kết quả; mỗi nhóm mở ra danh sách học phần; tên nhóm kèm mã nhóm CTĐT khi khác, ví dụ "Nhóm tự chọn TC306 (CTĐT: TC406)") và **Đối chiếu theo danh sách học phần** (ô tìm kiếm, bộ lọc trạng thái và bảng Mã | Tên học phần | Nhóm | TC | Điểm | Trạng thái). Nhãn trạng thái: Đã đạt, Miễn thi (MT), Chưa đạt, Đang học, Chưa rõ kết quả, Chưa học; kết quả suy ra ghi thêm "suy ra từ điểm chữ". Bảng cuộn trong khung riêng để trang không cuộn ngang trên điện thoại.

### Điểm, điểm trung bình và gợi ý nâng điểm

Cột **Điểm** hiển thị điểm theo thang của tiêu chuẩn trước (mặc định hệ 4), kèm thang còn lại và điểm chữ. Điểm lấy từ lần học được server chọn: lần MT nếu có, nếu không là lần đạt có điểm cao nhất, nếu chưa từng đạt là lần có điểm cao nhất. Điểm 0 được giữ; MT hiển thị "MT" (miễn thi) và không gán điểm số.

Điểm trung bình được kiểm tra riêng theo ngưỡng và thang điểm của tiêu chuẩn. Ưu tiên dòng **điểm trung bình tích lũy** đúng thang trong học kỳ có điểm gần nhất, không dùng điểm trung bình học kỳ hay bản tích lũy cũ. Nếu không có dòng tổng hợp đúng thang, tính **tham khảo** bằng điểm nhân tín chỉ, lấy điểm cao nhất mỗi mã một lần (học phần chưa từng đạt được tính bằng điểm cao nhất đã có, kể cả F); bỏ môn (*), môn điều kiện và MT, không đổi hệ 4 thành hệ 10 hoặc ngược lại. Thiếu điểm hay tín chỉ cần thiết, thiếu ngưỡng, ngưỡng vượt thang điểm hoặc dữ liệu tổng hợp không rõ sẽ báo chưa đủ dữ liệu. Khi chưa đạt, `remaining` của điểm trung bình là ngưỡng trừ điểm hiện tại; trang làm tròn mức thiếu lên 2 chữ số khi hiển thị.

Khi điểm trung bình chưa đạt, kết quả là **Chưa đạt** (cả khi mọi nhóm đã đạt; trường hợp này có cờ `needsImprovement`) và server trả tối đa 8 học phần gợi ý (`improvementCandidates`): học phần của tiêu chuẩn được tính vào điểm trung bình (không phải môn (*) hay môn điều kiện, không có lần MT hay lần học điều kiện, tín chỉ > 0, có điểm theo thang của tiêu chuẩn) mà điểm cao nhất theo thang đó thấp hơn ngưỡng. Học phần đã đạt là gợi ý **học cải thiện**; học phần chưa từng đạt là gợi ý **học lại**. Học phần đang học lại hoặc chưa rõ kết quả không được gợi ý. Thứ tự: điểm thấp trước, rồi nhiều tín chỉ trước, rồi theo mã. Ngưỡng điểm trung bình không phải ngưỡng đậu riêng của từng môn. Kết quả là đối chiếu tham khảo, không thay kết luận tốt nghiệp của trường.

## Cập nhật và trạng thái

**Chỉnh sửa thông tin** chỉnh tên, ngưỡng và ghi chú. **Chỉnh sửa nhóm** chỉnh tên, loại nhóm và tín chỉ yêu cầu. **Chỉnh sửa học phần** chỉnh mã, tên, tín chỉ, chuyển nhóm và cờ môn điều kiện. Mỗi lần lưu tạo phiên bản mới và kiểm tra token để chặn ghi đè thay đổi đồng thời. Các bản lịch sử chỉ đọc.

**Khóa tiêu chuẩn** đánh dấu ngừng áp dụng; quản trị vẫn có thể tìm bằng bộ lọc Đã khóa và **Mở khóa tiêu chuẩn**. Không xóa dữ liệu/lịch sử.

Các chức năng xét tốt nghiệp tự động chỉ dùng tiêu chuẩn đang mở và lưu phiên bản tiêu chuẩn đã dùng. Bộ chọn chung `apps/api/src/graduation/resolve.ts` chỉ đọc tiêu chuẩn đang mở (bản hiện hành), nên tiêu chuẩn vừa khóa không còn được chọn cho trang sinh viên, đánh giá năng lực và lời khuyên AI từ lần đọc kế tiếp. Kết quả đánh giá năng lực lưu `graduationStandardId`, `graduationStandardRevisionId`, `graduationStandardVersion` trong `meta`; mỗi lời khuyên AI (`stu_grad_advice`) lưu `standard_id`, `standard_revision_id`, `standard_version` cùng `calc_version` và `transcript_version`. Trang Điều kiện xét tốt nghiệp tính lại mỗi lần mở nên luôn theo bản hiện hành; khi tiêu chuẩn được sửa (revision mới), lời khuyên AI cũ thành lỗi thời và lời khuyên mới được tạo tự động lúc sinh viên mở trang.

## Triển khai và dữ liệu

Migration `013_graduation_standards.sql` thêm bảng tiêu chuẩn, phiên bản JSON, các môn điều kiện và nhật ký. Migration dùng cơ chế hiện có (`DATABASE_AUTO_MIGRATE=true`), bật RLS và thu hồi quyền truy cập trực tiếp của các role API Supabase. Backend tiếp tục kết nối PostgreSQL bằng cấu hình hiện tại. Không có thao tác seed tự động khi khởi động; local/Render không tự đồng bộ dữ liệu nếu dùng hai database riêng.

Bộ đọc Excel dùng [SheetJS CE từ nguồn phân phối chính thức](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/) để hỗ trợ cả XLS cũ và XLSX; chạy trong worker có giới hạn bộ nhớ/thời gian. ZIP và XLSX có giới hạn kích thước giải nén, số file/sheet/dòng. File nguồn thực của người dùng không được đưa vào GitHub.

## Kiểm tra lại

`npm run build` biên dịch API và web. Test `apps/api/src/graduation/parser.test.ts` luôn chạy các trường hợp dữ liệu giả lập; phần đối chiếu 9 file thật chỉ chạy khi có thư mục `output/graduation-audit/files` hoặc biến `GRADUATION_AUDIT_DIR` trỏ đến thư mục chứa các workbook nguồn. Thiếu nguồn riêng tư thì phần đối chiếu được bỏ qua.

Phần sinh viên có test riêng với dữ liệu tổng hợp: `apps/api/src/graduation/{resolve,evaluation,student-graduation,student-router}.test.ts` (chọn tiêu chuẩn, kết quả đối chiếu trùng số liệu với đánh giá năng lực, không đọc được tiêu chuẩn khác, `/:id` trả 404), `apps/api/src/competency-assessment/graduation.test.ts` (bộ máy chung, bảng ca `fixtures/graduation-cases.json`), `apps/web/src/student-graduation-data.test.ts` và `StudentGraduation.test.tsx`.

Sau build, `node scripts/verify-graduation.mjs` kiểm tra luồng API quản trị trên schema tạm. Script yêu cầu `apps/api/.env` trỏ đến PostgreSQL localhost và các bản sao workbook trong `output/graduation-audit/files`; không chạy với Supabase/Render. Schema thử nghiệm được dọn trong `finally`. Thêm `--ui` để giữ máy chủ fixture phục vụ kiểm tra giao diện, kết thúc bằng Ctrl+C để dọn schema.

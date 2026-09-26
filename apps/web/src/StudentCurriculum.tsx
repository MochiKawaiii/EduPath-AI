import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLiveFilters } from "./use-live-filters";
import {
  courseKind,
  courseTypeLabel,
  searchableCourse,
  searchTerm,
  termLabel,
  type StudentCourse,
  type StudentCurriculumData,
  type StudentCurriculumList,
} from "./student-curriculum-types";
import { Icon } from "./student-icons";
import { useLiveData } from "./use-live-data";
import "./student-curriculum.css";

const endpoint = "/api/student/curricula";
async function readCurriculum<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const message =
      res.status === 401
        ? "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại."
        : res.status === 403
          ? "Tài khoản hiện không thể truy cập dữ liệu."
          : res.status === 404
            ? "Khung này không còn được mở để tra cứu. Hãy chọn khung khác."
            : "Chưa tải được chương trình đào tạo. Vui lòng thử lại.";
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}
function useCurriculumRequest<T>(url: string, revision: number) {
  return useLiveData<T>(url, revision, readCurriculum);
}

export default function StudentCurriculum() {
  const [revision, setRevision] = useState(0),
    [choice, setChoice] = useState<string | null>(null);
  const list = useCurriculumRequest<StudentCurriculumList>(endpoint, revision);
  const chosen = choice ?? list.data?.suggestedId ?? "";
  const selected = list.data?.items.find((item) => item.id === chosen);
  const sameCohort =
    selected && selected.cohortCode === list.data?.profileCohort;
  return (
    <div className="sc-workspace">
      <section className="sw-panel sc-selector">
        <div>
          <p className="sc-eyebrow">KHUNG CHƯƠNG TRÌNH</p>
          <h2>Tra cứu chương trình đào tạo</h2>
          <p className="sc-muted">
            Tìm hiểu các học phần và điều kiện học trước khi lên kế hoạch cho
            từng học kỳ.
          </p>
        </div>
        <div className="sc-selector-controls">
          <label>
            Chương trình đang mở
            <select
              value={selected?.id ?? ""}
              disabled={list.loading || !list.data?.items.length}
              onChange={(e) => setChoice(e.target.value)}
            >
              <option value="">Chọn chương trình đào tạo</option>
              {list.data?.items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.cohortCode} · {item.major}
                </option>
              ))}
            </select>
          </label>
        </div>
        {list.loading && (
          <p role="status" className="sc-muted">
            Đang tải danh sách chương trình…
          </p>
        )}
        {list.error && (
          <p role="alert" className="sw-error">
            {list.error}
          </p>
        )}
        {list.data && (
          <p className="sc-selection-note">
            {!list.data.items.length
              ? "Chưa có khung chương trình đào tạo đang mở. Vui lòng quay lại sau."
              : !list.data.profileCohort
                ? "Hồ sơ chưa có khóa học. Bạn có thể chọn một chương trình để tham khảo."
                : !list.data.items.some(
                  (item) => item.cohortCode === list.data!.profileCohort,
                )
                  ? `Chưa có khung đang mở cho ${list.data.profileCohort}. Các khung khác chỉ dùng để tham khảo.`
                  : sameCohort
                    ? `Khung cùng khóa ${list.data.profileCohort} trong hồ sơ của bạn. Hãy đối chiếu ngành học khi lựa chọn.`
                    : selected
                      ? `Bạn đang tham khảo khung ${selected.cohortCode}; khóa trong hồ sơ là ${list.data.profileCohort}.`
                      : `Chọn chương trình phù hợp với khóa ${list.data.profileCohort} và ngành học của bạn.`}
          </p>
        )}
      </section>
      {selected && (
        <CurriculumContent
          key={selected.id}
          id={selected.id}
          revision={revision}
          retry={() => setRevision((n) => n + 1)}
        />
      )}
      {!list.loading && list.data?.items.length && !selected ? (
        <section className="sw-panel sc-empty">
          <h2>Chọn một khung để bắt đầu</h2>
          <p>
            Bạn sẽ xem được số tín chỉ, nhóm môn bắt buộc/tự chọn và điều kiện
            của từng học phần.
          </p>
        </section>
      ) : null}
    </div>
  );
}

function CurriculumContent({
  id,
  revision,
  retry,
}: {
  id: string;
  revision: number;
  retry: () => void;
}) {
  const remote = useCurriculumRequest<StudentCurriculumData>(
    `${endpoint}/${id}`,
    revision,
  );
  const [opened, setOpened] = useState<string | null>(null);
  const { draft, setDraft, filters, reset } = useLiveFilters({
    q: "",
    group: "",
    kind: "",
    specialty: "",
    semester: "",
    year: "",
  });
  if (remote.loading)
    return (
      <section className="sw-panel sc-empty" role="status">
        Đang tải học phần…
      </section>
    );
  if (remote.error)
    return (
      <section className="sw-panel sc-empty">
        <p role="alert" className="sw-error">
          {remote.error}
        </p>
        <button className="sw-outline" onClick={retry}>
          <Icon name="refresh" /> Thử lại
        </button>
      </section>
    );
  const data = remote.data;
  if (!data) return null;
  const term = searchTerm(filters.q);
  const courses = data.courses.filter(
    (c) =>
      (!term || searchableCourse(c).includes(term)) &&
      (!filters.group || c.groupId === filters.group) &&
      (!filters.kind || courseKind(c.type) === filters.kind) &&
      (!filters.specialty || c.specialty === filters.specialty) &&
      (!filters.semester || String(c.semester) === filters.semester) &&
      (!filters.year || String(c.studyYear) === filters.year),
  );
  const selected = data.courses.find((c) => c.code === opened);
  const groups = new Map(data.groups.map((g) => [g.id, g.label]));
  return (
    <>
      <section className="sw-panel sc-summary">
        <div className="sc-summary-title">
          <div>
            <p className="sc-eyebrow">
              {data.cohortCode} · Nhập học {data.admissionYear}
            </p>
            <h2>{data.name}</h2>
          </div>
          <span className="sc-badge">Phiên bản {data.version}</span>
        </div>
        <dl className="sc-stats">
          <div>
            <dt>Tín chỉ chương trình</dt>
            <dd>
              {data.totalCredits}
              <small>Theo quy định của khung</small>
            </dd>
          </div>
          <div>
            <dt>Học phần trong danh mục</dt>
            <dd>
              {data.courses.length}
              <small>Gồm các phương án lựa chọn</small>
            </dd>
          </div>
          <div>
            <dt>Nhóm môn tự chọn</dt>
            <dd>
              {data.electives.length}
              <small>Chọn theo yêu cầu từng nhóm</small>
            </dd>
          </div>
        </dl>
        <p className="sc-muted">
          Không cần học tất cả môn trong danh mục. Môn tự chọn và chuyên ngành
          áp dụng theo quy định của chương trình.
        </p>
        {!!data.electives.length && (
          <details className="sc-electives">
            <summary>Xem các nhóm tự chọn</summary>
            <div>
              {data.electives.map((group) => (
                <article key={group.code}>
                  <strong>{group.code}</strong>
                  <p>
                    {group.requiredCredits === null
                      ? "Xem quy định tín chỉ trong khung hoặc liên hệ cố vấn học tập."
                      : `Chọn ${group.requiredCredits} tín chỉ`}
                  </p>
                  <small>{group.courseCodes.length} học phần trong nhóm</small>
                </article>
              ))}
            </div>
          </details>
        )}
      </section>
      <section className="sw-panel sc-catalog">
        <div className="sc-catalog-heading">
          <div>
            <h2>Danh sách học phần</h2>
            <p className="sc-muted">
              Chọn tên học phần để xem mô tả và điều kiện học.
            </p>
          </div>
          <span className="sc-badge" role="status">
            {courses.length} / {data.courses.length} học phần
          </span>
        </div>
        <div className="sc-filters">
          <label className="sc-search">
            Tìm học phần
            <input
              type="search"
              placeholder="Mã hoặc tên môn học…"
              value={draft.q}
              onChange={(e) => setDraft({ ...draft, q: e.target.value })}
            />
          </label>
          <label>
            Khối kiến thức
            <select
              value={draft.group}
              onChange={(e) => setDraft({ ...draft, group: e.target.value })}
            >
              <option value="">Tất cả khối</option>
              {data.groups
                .filter((g) => data.courses.some((c) => c.groupId === g.id))
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.label}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Loại môn
            <select
              value={draft.kind}
              onChange={(e) => setDraft({ ...draft, kind: e.target.value })}
            >
              <option value="">Tất cả loại</option>
              <option value="required">Bắt buộc</option>
              <option value="elective">Tự chọn</option>
            </select>
          </label>
          <label>
            Chuyên ngành
            <select
              value={draft.specialty}
              onChange={(e) =>
                setDraft({ ...draft, specialty: e.target.value })
              }
            >
              <option value="">Tất cả chuyên ngành</option>
              {[
                ...new Set(
                  data.courses.map((c) => c.specialty).filter(Boolean),
                ),
              ].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Năm học
            <select
              value={draft.year}
              onChange={(e) => setDraft({ ...draft, year: e.target.value })}
            >
              <option value="">Tất cả năm</option>
              {[
                ...new Set(
                  data.courses
                    .map((c) => c.studyYear)
                    .filter((n): n is number => n !== null),
                ),
              ]
                .sort((a, b) => a - b)
                .map((n) => (
                  <option key={n} value={n}>
                    Năm {n}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Học kỳ
            <select
              value={draft.semester}
              onChange={(e) => setDraft({ ...draft, semester: e.target.value })}
            >
              <option value="">Tất cả học kỳ</option>
              {[1, 2, 3].map((n) => (
                <option key={n} value={n}>
                  Học kỳ {n}
                </option>
              ))}
            </select>
          </label>
          <button className="sw-outline" onClick={reset}>
            Xóa bộ lọc
          </button>
        </div>
        <div
          className="sc-table-wrap"
          tabIndex={0}
          role="region"
          aria-label="Danh sách học phần, có thể cuộn ngang"
        >
          <table className="sc-table">
            <thead>
              <tr>
                <th>Mã học phần</th>
                <th>Học phần</th>
                <th>Tín chỉ</th>
                <th>Loại môn</th>
                <th>Năm · Học kỳ</th>
                <th>Tiên quyết</th>
              </tr>
            </thead>
            <tbody>
              {courses.map((c, i) => (
                <Fragment key={c.code}>
                  {c.groupId !== courses[i - 1]?.groupId && (
                    <tr className="sc-group">
                      <th colSpan={6} scope="rowgroup">
                        {groups.get(c.groupId) ?? "Học phần"}
                      </th>
                    </tr>
                  )}
                  <tr>
                    <td>{c.code}</td>
                    <th scope="row">
                      <button
                        className="sc-course-link"
                        onClick={() => setOpened(c.code)}
                      >
                        {c.name}
                      </button>
                      <small>{c.englishName}</small>
                    </th>
                    <td>{c.credits}</td>
                    <td>
                      <span
                        className={`sc-badge ${courseKind(c.type) === "elective" ? "sc-elective" : ""}`}
                      >
                        {courseTypeLabel(c.type)}
                      </span>
                    </td>
                    <td className="sc-term">
                      {termLabel(c.studyYear, c.semester)}
                    </td>
                    <td>
                      <span className="sc-condition-text">
                        {c.prerequisite || "Không ghi trong khung"}
                      </span>
                      {c.conditions.some(
                        (r) => r.kind === "prerequisite" && r.reviewRequired,
                      ) && (
                          <small className="sc-review">
                            Cần xác nhận điều kiện
                          </small>
                        )}
                    </td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        {!courses.length && (
          <div className="sc-empty">
            <h3>Không tìm thấy học phần phù hợp</h3>
            <p>Thử thay đổi từ khóa hoặc xóa bộ lọc.</p>
            <button className="sw-outline" onClick={reset}>
              Xóa bộ lọc
            </button>
          </div>
        )}
      </section>
      {selected && (
        <CourseDetail
          course={selected}
          data={data}
          onClose={() => setOpened(null)}
          onCourse={setOpened}
        />
      )}
    </>
  );
}

function CourseDetail({
  course,
  data,
  onClose,
  onCourse,
}: {
  course: StudentCourse;
  data: StudentCurriculumData;
  onClose: () => void;
  onCourse: (code: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    opener = useRef<HTMLElement | null>(null),
    heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    opener.current = document.activeElement as HTMLElement;
    dialog.current?.showModal();
    return () => {
      dialog.current?.close();
      if (opener.current?.isConnected) opener.current.focus();
    };
  }, []);
  useEffect(() => {
    heading.current?.focus();
  }, [course.code]);
  return (
    <dialog
      ref={dialog}
      className="sc-dialog"
      aria-labelledby="student-course-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header>
        <div>
          <p className="sc-eyebrow">
            {course.code} · {data.cohortCode}
          </p>
          <h2 id="student-course-title" ref={heading} tabIndex={-1}>
            {course.name}
          </h2>
          {course.englishName && (
            <p className="sc-muted">{course.englishName}</p>
          )}
        </div>
        <button className="sw-outline" onClick={onClose}>
          Đóng
        </button>
      </header>
      <div className="sc-dialog-content">
        <div className="sc-course-meta">
          <span className="sc-badge">{course.credits} tín chỉ</span>
          <span className="sc-badge">{courseTypeLabel(course.type)}</span>
          <span className="sc-badge">
            Năm {course.studyYear ?? "—"} · Học kỳ {course.semester ?? "—"}
          </span>
        </div>
        <section>
          <h3>Mô tả học phần</h3>
          <p className="sc-prewrap">
            {course.description ||
              "Nhà trường chưa cung cấp mô tả chi tiết cho học phần này."}
          </p>
        </section>
        {(["prerequisite", "prior"] as const).map((kind) => {
          const condition = course.conditions.find((r) => r.kind === kind);
          return (
            <section key={kind} className="sc-condition">
              <h3>
                {kind === "prerequisite"
                  ? "Điều kiện tiên quyết"
                  : "Học phần học trước"}
              </h3>
              <p className="sc-prewrap">
                {course[kind] ||
                  "Không ghi điều kiện trong khung chương trình."}
              </p>
              {condition?.reviewRequired && (
                <p className="sc-review">
                  Điều kiện này cần nhà trường xác nhận. Liên hệ cố vấn học tập
                  trước khi lập kế hoạch đăng ký.
                </p>
              )}
              <div className="sc-related">
                {condition?.targetCodes.map((code) => {
                  const related = data.courses.find((c) => c.code === code);
                  return related && code !== course.code ? (
                    <button
                      key={code}
                      className="sw-outline"
                      onClick={() => onCourse(code)}
                    >
                      {related.code} · {related.name}
                    </button>
                  ) : null;
                })}
              </div>
            </section>
          );
        })}
        <dl className="sc-course-fields">
          <div>
            <dt>Khối kiến thức</dt>
            <dd>
              {course.block ||
                data.groups.find((g) => g.id === course.groupId)?.label ||
                "Chưa xác định"}
            </dd>
          </div>
          <div>
            <dt>Chuyên ngành</dt>
            <dd>{course.specialty || "Không ghi trong khung"}</dd>
          </div>
          <div>
            <dt>Bộ môn</dt>
            <dd>{course.department || "Chưa cập nhật"}</dd>
          </div>
          <div>
            <dt>Giờ lý thuyết / thực hành / đồ án / thực tập</dt>
            <dd>
              {[
                course.hours.lecture,
                course.hours.practice,
                course.hours.project,
                course.hours.internship,
              ]
                .map((n) => n ?? "—")
                .join(" / ")}
            </dd>
          </div>
        </dl>
        {course.scheduleNeedsReview && (
          <p className="sc-muted">
            Chưa xác định đầy đủ năm hoặc học kỳ dự kiến cho học phần này.
          </p>
        )}
        {course.notes && (
          <section>
            <h3>Ghi chú trong khung</h3>
            <p className="sc-prewrap">{course.notes}</p>
          </section>
        )}
      </div>
    </dialog>
  );
}
